export type MeetingMessageStyle = 'suggest' | 'request' | 'offer';

const templates: Record<MeetingMessageStyle, (time: string) => string> = {
  suggest: (time) => `Let's meet at ${time}!`,
  request: (time) => `I want to meet at ${time}!`,
  offer: (time) => `Would you like to meet at ${time}?`,
};

export function createMeetingMessage(
  time: string,
  style: MeetingMessageStyle = 'suggest',
): string {
  const normalizedTime = time.trim();

  if (normalizedTime.length === 0) {
    throw new TypeError('Meeting time must not be blank.');
  }

  return templates[style](normalizedTime);
}

export function meet(time: string): string {
  return createMeetingMessage(time, 'suggest');
}

export function meetNew(time: string): string {
  return createMeetingMessage(time, 'request');
}

export function offerMeeting(time: string): string {
  return createMeetingMessage(time, 'offer');
}
