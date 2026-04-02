type SecretRule = {
  id: string
  label: string
  pattern: RegExp
}

export type SecretMatch = {
  id: string
  label: string
}

const SECRET_RULES: SecretRule[] = [
  {
    id: 'anthropic-api-key',
    label: 'Anthropic API key',
    pattern: /\bsk-ant-(?:api|admin)[a-z0-9_-]{20,}\b/i,
  },
  {
    id: 'openai-api-key',
    label: 'OpenAI API key',
    pattern: /\bsk-(?:proj|svcacct|admin)-[a-z0-9_-]{20,}\b/i,
  },
  {
    id: 'github-pat',
    label: 'GitHub token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9a-z]{24,}\b/i,
  },
  {
    id: 'aws-access-key',
    label: 'AWS access key',
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/,
  },
  {
    id: 'npm-token',
    label: 'NPM token',
    pattern: /\bnpm_[a-z0-9]{20,}\b/i,
  },
  {
    id: 'slack-token',
    label: 'Slack token',
    pattern: /\bxox(?:b|p|e|s|a)-[0-9a-z-]{20,}\b/i,
  },
  {
    id: 'private-key',
    label: 'Private key material',
    pattern: /-----BEGIN(?:[ A-Z0-9_-]+)?PRIVATE KEY-----[\s\S]{40,}-----END(?:[ A-Z0-9_-]+)?PRIVATE KEY-----/i,
  },
]

export function scanTextForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = []
  for (const rule of SECRET_RULES) {
    if (rule.pattern.test(content)) {
      matches.push({
        id: rule.id,
        label: rule.label,
      })
    }
  }
  return matches
}

export function describeSecretMatches(matches: SecretMatch[]): string {
  if (!matches.length) {
    return 'No high-confidence secrets detected'
  }
  return matches.map(match => match.label).join(', ')
}
