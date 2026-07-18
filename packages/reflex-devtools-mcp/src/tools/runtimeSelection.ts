export interface RuntimeSelectionParams {
  runtimeId?: string;
}

export const runtimeIdInputProperty = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
  description:
    'Optional runtime id from app_status. Required when multiple Reflex runtimes are connected.',
};

export function runtimeMetadata(response: any): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (response?.runtimeId !== undefined) {
    metadata.runtimeId = response.runtimeId;
  }
  if (response?.runtimeName !== undefined) {
    metadata.runtimeName = response.runtimeName;
  }
  if (response?.sessionEpoch !== undefined) {
    metadata.sessionEpoch = response.sessionEpoch;
  }
  return metadata;
}
