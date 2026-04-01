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

type TeamStore = {
  teams: LocalTeam[]
}

function createStore(): TeamStore {
  return { teams: [] }
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
