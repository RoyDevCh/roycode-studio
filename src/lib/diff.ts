import type { DiffLine } from '../types'

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').split('\n')
}

function buildFastFallback(before: string[], after: string[]): DiffLine[] {
  const maxLength = Math.max(before.length, after.length)
  const output: DiffLine[] = []

  for (let index = 0; index < maxLength; index += 1) {
    const left = before[index]
    const right = after[index]

    if (left === right) {
      output.push({
        type: 'context',
        leftNumber: left === undefined ? undefined : index + 1,
        rightNumber: right === undefined ? undefined : index + 1,
        text: left ?? right ?? '',
      })
      continue
    }

    if (left !== undefined) {
      output.push({
        type: 'remove',
        leftNumber: index + 1,
        text: left,
      })
    }

    if (right !== undefined) {
      output.push({
        type: 'add',
        rightNumber: index + 1,
        text: right,
      })
    }
  }

  return output
}

export function buildLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const before = splitLines(beforeText)
  const after = splitLines(afterText)

  if (before.length * after.length > 200_000) {
    return buildFastFallback(before, after)
  }

  const dp: number[][] = Array.from({ length: before.length + 1 }, () =>
    Array.from({ length: after.length + 1 }, () => 0),
  )

  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      if (before[i] === after[j]) {
        dp[i]![j] = (dp[i + 1]![j + 1] ?? 0) + 1
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0)
      }
    }
  }

  const output: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      output.push({
        type: 'context',
        leftNumber: i + 1,
        rightNumber: j + 1,
        text: before[i] ?? '',
      })
      i += 1
      j += 1
      continue
    }

    if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      output.push({
        type: 'remove',
        leftNumber: i + 1,
        text: before[i] ?? '',
      })
      i += 1
      continue
    }

    output.push({
      type: 'add',
      rightNumber: j + 1,
      text: after[j] ?? '',
    })
    j += 1
  }

  while (i < before.length) {
    output.push({
      type: 'remove',
      leftNumber: i + 1,
      text: before[i] ?? '',
    })
    i += 1
  }

  while (j < after.length) {
    output.push({
      type: 'add',
      rightNumber: j + 1,
      text: after[j] ?? '',
    })
    j += 1
  }

  return output
}
