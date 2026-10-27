import type { Messages } from './types.js';

/** Default (en-NZ) validation messages. Hosts override via EngineOptions.messages. */
export const DEFAULT_MESSAGES: Messages = {
  required: ({ label }) => `Enter ${label}`,
  requiredGroup: ({ label }) => `Answer at least one question in ${label}`,
  minLength: ({ label, limit }) => `${label} must be ${limit} characters or more`,
  maxLength: ({ label, limit }) => `${label} must be ${limit} characters or fewer`,
  regex: ({ label }) => `${label} is not in the correct format`,
  minValue: ({ label, limit }) => `${label} must be ${limit} or more`,
  maxValue: ({ label, limit }) => `${label} must be ${limit} or less`,
  maxDecimalPlaces: ({ label, limit }) => `${label} must have ${limit} decimal places or fewer`,
  minOccurs: ({ label, limit }) => `Give at least ${limit} answers for ${label}`,
  maxOccurs: ({ label, limit }) => `Give no more than ${limit} answers for ${label}`,
  maxSize: ({ label, limit }) => `The file for ${label} must be smaller than ${limit}`,
  mimeType: ({ label }) => `The file for ${label} must be an allowed type`,
  optionsOnly: ({ label }) => `Select one of the options for ${label}`,
};
