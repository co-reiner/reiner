import { describe, expect, it } from 'vitest';

import {
  createMeetingMessage,
  meet,
  meetNew,
  offerMeeting,
} from '../src/meeting.ts';

describe('createMeetingMessage', () => {
  it('creates a suggestion by default', () => {
    expect(createMeetingMessage('10:00')).toBe("Let's meet at 10:00!");
  });

  it('creates each supported message style', () => {
    expect(createMeetingMessage('tomorrow', 'request')).toBe(
      'I want to meet at tomorrow!',
    );
    expect(createMeetingMessage('noon', 'offer')).toBe(
      'Would you like to meet at noon?',
    );
  });

  it('trims the supplied time', () => {
    expect(createMeetingMessage('  10:00  ')).toBe("Let's meet at 10:00!");
  });

  it.each(['', ' ', '\t\n'])('rejects a blank time: %j', (time) => {
    expect(() => createMeetingMessage(time)).toThrow(
      new TypeError('Meeting time must not be blank.'),
    );
  });
});

describe('compatibility functions', () => {
  it('preserves the existing named operations', () => {
    expect(meet('10:00')).toBe("Let's meet at 10:00!");
    expect(meetNew('tomorrow')).toBe('I want to meet at tomorrow!');
    expect(offerMeeting('noon')).toBe('Would you like to meet at noon?');
  });
});
