import { randomUUID } from 'node:crypto'
import type { ProviderConfig, ProviderPreset, ProviderPresetId } from './types.js'

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'OpenAI-compatible chat/completions endpoint with code and reasoning models.',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    docsUrl: 'https://api-docs.deepseek.com/',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    description: 'OpenAI-compatible text API for MiniMax family models.',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
    docsUrl: 'https://platform.minimaxi.com/docs/api-reference/text-openai-api',
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-Compatible',
    description: 'Bring any endpoint that speaks the OpenAI Chat Completions protocol.',
    baseUrl: 'https://your-endpoint.example.com/v1',
    models: [],
  },
]

export function getPreset(presetId: ProviderPresetId): ProviderPreset {
  const preset = PROVIDER_PRESETS.find(item => item.id === presetId)
  if (!preset) {
    throw new Error(`Unknown preset: ${presetId}`)
  }
  return preset
}

export function createProviderFromPreset(
  presetId: ProviderPresetId,
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  const preset = getPreset(presetId)
  return {
    id: overrides.id ?? randomUUID(),
    name: overrides.name ?? preset.name,
    preset: preset.id,
    baseUrl: overrides.baseUrl ?? preset.baseUrl,
    apiKey: overrides.apiKey ?? '',
    models: overrides.models ?? preset.models,
    defaultModel: overrides.defaultModel ?? preset.models[0],
    enabled: overrides.enabled ?? true,
    notes: overrides.notes,
  }
}
