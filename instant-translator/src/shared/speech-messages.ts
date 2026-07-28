export const SPEECH_MESSAGE_TYPE = {
  SPEAK_TEXT: 'SPEAK_TEXT',
  STOP_SPEECH: 'STOP_SPEECH',

  SPEECH_PLAYBACK_EVENT:
    'SPEECH_PLAYBACK_EVENT',
} as const;

export type SpeechTarget =
  | 'source'
  | 'translation';

export type SpeechPlaybackEventType =
  | 'start'
  | 'end'
  | 'interrupted'
  | 'cancelled'
  | 'error';

export interface SpeechPlaybackEventMessage {
  type:
    typeof SPEECH_MESSAGE_TYPE
      .SPEECH_PLAYBACK_EVENT;

  payload: {
    requestId: string;
    target: SpeechTarget;

    eventType:
      SpeechPlaybackEventType;

    errorMessage?: string;
  };
}
export type SpeechErrorCode =
  | 'INVALID_REQUEST'
  | 'TEXT_EMPTY'
  | 'TEXT_TOO_LONG'
  | 'TTS_UNAVAILABLE'
  | 'SPEECH_FAILED';

export interface SpeakTextMessage {
  type:
    typeof SPEECH_MESSAGE_TYPE.SPEAK_TEXT;

  payload: {
    requestId: string;
    text: string;
    target: SpeechTarget;
    lang?: string;
    rate: number;
    pitch: number;
  };
}

export interface StopSpeechMessage {
  type:
    typeof SPEECH_MESSAGE_TYPE.STOP_SPEECH;

  payload: {
    requestId: string;
  };
}

export type SpeechMessage =
  | SpeakTextMessage
  | StopSpeechMessage
  | SpeechPlaybackEventMessage;
export interface SpeechError {
  code: SpeechErrorCode;
  message: string;
}

export type SpeechResponse =
  | {
      ok: true;
      requestId: string;
    }
  | {
      ok: false;
      requestId: string;
      error: SpeechError;
    };

export function isSpeakTextMessage(
  value: unknown,
): value is SpeakTextMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.type !==
    SPEECH_MESSAGE_TYPE.SPEAK_TEXT
  ) {
    return false;
  }

  if (!isRecord(value.payload)) {
    return false;
  }

  return (
    typeof value.payload.requestId ===
      'string' &&
    typeof value.payload.text ===
      'string' &&
    (
      value.payload.target ===
        'source' ||
      value.payload.target ===
        'translation'
    ) &&
    (
      value.payload.lang ===
        undefined ||
      typeof value.payload.lang ===
        'string'
    ) &&
    typeof value.payload.rate ===
      'number' &&
    typeof value.payload.pitch ===
      'number'
  );
}

export function isStopSpeechMessage(
  value: unknown,
): value is StopSpeechMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.type !==
    SPEECH_MESSAGE_TYPE.STOP_SPEECH
  ) {
    return false;
  }

  if (!isRecord(value.payload)) {
    return false;
  }

  return (
    typeof value.payload.requestId ===
    'string'
  );
}

export function isSpeechResponse(
  value: unknown,
): value is SpeechResponse {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.ok !== 'boolean' ||
    typeof value.requestId !== 'string'
  ) {
    return false;
  }

  if (value.ok) {
    return true;
  }

  return (
    isRecord(value.error) &&
    typeof value.error.code ===
      'string' &&
    typeof value.error.message ===
      'string'
  );
}
export function isSpeechPlaybackEventMessage(
  value: unknown,
): value is SpeechPlaybackEventMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.type !==
    SPEECH_MESSAGE_TYPE
      .SPEECH_PLAYBACK_EVENT
  ) {
    return false;
  }

  if (!isRecord(value.payload)) {
    return false;
  }

  const eventType =
    value.payload.eventType;

  return (
    typeof value.payload.requestId ===
      'string' &&
    (
      value.payload.target ===
        'source' ||
      value.payload.target ===
        'translation'
    ) &&
    (
      eventType === 'start' ||
      eventType === 'end' ||
      eventType ===
        'interrupted' ||
      eventType ===
        'cancelled' ||
      eventType === 'error'
    ) &&
    (
      value.payload.errorMessage ===
        undefined ||
      typeof value.payload
        .errorMessage ===
        'string'
    )
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}