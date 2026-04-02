import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const TEAMS_PATH = path.join(DATA_DIR, 'teams.json')

export type LocalTeamMember = {
  name: string
  agentName?: string
  rolePrompt?: string
}

export type LocalTeam = {
  id: string
  name: string
  description?: string
  members: LocalTeamMember[]
  createdAt: string
  updatedAt: string
}

export type LocalTeamMessage = {
  id: string
  teamName: string
  from: string
  to: string
  content: string
  createdAt: string
}

export type LocalTeamMemory = {
  teamName: string
  content: string
  updatedAt: string
}

type TeamStore = {
  teams: LocalTeam[]
  messages: LocalTeamMessage[]
  memories: LocalTeamMemory[]
}

function createStore(): TeamStore {
  return { teams: [], messages: [], memories: [] }
}

function normalizeName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  if (!slug) {
    throw new Error('Name must contain letters or numbers')
  }
  return slug
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(TEAMS_PATH, 'utf8')
  } catch {
    await writeFile(TEAMS_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<TeamStore> {
  await ensureStore()
  const raw = await readFile(TEAMS_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<TeamStore>
  return {
    teams: Array.isArray(parsed.teams) ? parsed.teams : [],
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    memories: Array.isArray(parsed.memories) ? parsed.memories : [],
  }
}

async function writeStore(store: TeamStore): Promise<void> {
  await ensureStore()
  await writeFile(TEAMS_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export async function listTeams(): Promise<LocalTeam[]> {
  const store = await readStore()
  return [...store.teams].sort((left, right) => left.name.localeCompare(right.name))
}

export async function getTeam(reference: string): Promise<LocalTeam | null> {
  const normalized = normalizeName(reference)
  const teams = await listTeams()
  return (
    teams.find(team => team.name === normalized) ??
    teams.find(team => team.name.startsWith(normalized)) ??
    teams.find(team => team.name.includes(normalized)) ??
    null
  )
}

export async function createTeam(args: {
  name: string
  description?: string
  members?: LocalTeamMember[]
}): Promise<LocalTeam> {
  const store = await readStore()
  const name = normalizeName(args.name)
  const now = new Date().toISOString()
  const next: LocalTeam = {
    id: `team_${Date.now().toString(36)}`,
    name,
    description: args.description?.trim() || undefined,
    members: args.members ?? [],
    createdAt: now,
    updatedAt: now,
  }

  const index = store.teams.findIndex(team => team.name === name)
  if (index >= 0) {
    throw new Error(`Team already exists: ${name}`)
  }

  store.teams.push(next)
  await writeStore(store)
  return next
}

export async function updateTeam(
  reference: string,
  updater: (team: LocalTeam) => LocalTeam,
): Promise<LocalTeam> {
  const store = await readStore()
  const normalized = normalizeName(reference)
  const index = store.teams.findIndex(team => team.name === normalized)
  if (index < 0) {
    throw new Error(`Team not found: ${reference}`)
  }

  const next = updater(store.teams[index]!)
  next.name = normalizeName(next.name)
  next.updatedAt = new Date().toISOString()
  store.teams[index] = next
  await writeStore(store)
  return next
}

export async function removeTeam(reference: string): Promise<void> {
  const store = await readStore()
  const normalized = normalizeName(reference)
  store.teams = store.teams.filter(team => team.name !== normalized)
  store.messages = store.messages.filter(message => message.teamName !== normalized)
  store.memories = store.memories.filter(memory => memory.teamName !== normalized)
  await writeStore(store)
}

export async function addTeamMember(
  reference: string,
  member: LocalTeamMember,
): Promise<LocalTeam> {
  return updateTeam(reference, team => {
    const normalizedMember = normalizeName(member.name)
    const nextMembers = team.members.filter(item => item.name !== normalizedMember)
    nextMembers.push({
      name: normalizedMember,
      agentName: member.agentName?.trim() || undefined,
      rolePrompt: member.rolePrompt?.trim() || undefined,
    })
    return {
      ...team,
      members: nextMembers,
    }
  })
}

export async function removeTeamMember(
  reference: string,
  memberName: string,
): Promise<LocalTeam> {
  const normalizedMember = normalizeName(memberName)
  return updateTeam(reference, team => ({
    ...team,
    members: team.members.filter(member => member.name !== normalizedMember),
  }))
}

export async function listTeamMessages(
  reference: string,
  memberName?: string,
): Promise<LocalTeamMessage[]> {
  const store = await readStore()
  const team = await getTeam(reference)
  if (!team) {
    throw new Error(`Team not found: ${reference}`)
  }
  const normalizedMember = memberName ? normalizeName(memberName) : null
  return store.messages
    .filter(message => {
      if (message.teamName !== team.name) {
        return false
      }
      if (!normalizedMember) {
        return true
      }
      return (
        message.to === 'all' ||
        message.to === normalizedMember ||
        message.from === normalizedMember
      )
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export async function sendTeamMessage(args: {
  team: string
  from: string
  to?: string
  content: string
}): Promise<LocalTeamMessage> {
  const store = await readStore()
  const team = await getTeam(args.team)
  if (!team) {
    throw new Error(`Team not found: ${args.team}`)
  }

  const now = new Date().toISOString()
  const next: LocalTeamMessage = {
    id: `teammsg_${Date.now().toString(36)}`,
    teamName: team.name,
    from: normalizeName(args.from),
    to: args.to ? normalizeName(args.to) : 'all',
    content: args.content.trim(),
    createdAt: now,
  }
  store.messages.push(next)
  await writeStore(store)
  return next
}

export async function clearTeamMessages(
  reference: string,
  memberName?: string,
): Promise<number> {
  const store = await readStore()
  const team = await getTeam(reference)
  if (!team) {
    throw new Error(`Team not found: ${reference}`)
  }

  const before = store.messages.length
  const normalizedMember = memberName ? normalizeName(memberName) : null
  store.messages = store.messages.filter(message => {
    if (message.teamName !== team.name) {
      return true
    }
    if (!normalizedMember) {
      return false
    }
    return !(
      message.to === 'all' ||
      message.to === normalizedMember ||
      message.from === normalizedMember
    )
  })
  await writeStore(store)
  return before - store.messages.length
}

export async function getTeamMemory(reference: string): Promise<LocalTeamMemory | null> {
  const store = await readStore()
  const team = await getTeam(reference)
  if (!team) {
    throw new Error(`Team not found: ${reference}`)
  }
  return store.memories.find(memory => memory.teamName === team.name) ?? null
}

export async function setTeamMemory(
  reference: string,
  content: string,
): Promise<LocalTeamMemory> {
  const store = await readStore()
  const team = await getTeam(reference)
  if (!team) {
    throw new Error(`Team not found: ${reference}`)
  }
  const next: LocalTeamMemory = {
    teamName: team.name,
    content: content.trim(),
    updatedAt: new Date().toISOString(),
  }
  const index = store.memories.findIndex(memory => memory.teamName === team.name)
  if (index >= 0) {
    store.memories[index] = next
  } else {
    store.memories.push(next)
  }
  await writeStore(store)
  return next
}

export async function appendTeamMemory(
  reference: string,
  content: string,
): Promise<LocalTeamMemory> {
  const current = await getTeamMemory(reference)
  return setTeamMemory(
    reference,
    [current?.content?.trim(), content.trim()].filter(Boolean).join('\n\n'),
  )
}

export async function syncTeamMemoryFromMessages(reference: string): Promise<LocalTeamMemory> {
  const team = await getTeam(reference)
  if (!team) {
    throw new Error(`Team not found: ${reference}`)
  }
  const messages = await listTeamMessages(team.name)
  const recent = messages.slice(-20)
  const summary = [
    `# Team Memory: ${team.name}`,
    team.description ? `Description: ${team.description}` : '',
    recent.length ? 'Recent message highlights:' : 'No team messages yet.',
    ...recent.map(
      message =>
        `- [${message.createdAt}] ${message.from} -> ${message.to}: ${message.content.replace(/\s+/g, ' ')}`,
    ),
  ]
    .filter(Boolean)
    .join('\n')
  return setTeamMemory(team.name, summary)
}
