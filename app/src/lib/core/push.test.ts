import { describe, expect, it } from 'vitest';
import { reminderSupport, subscriptionBody } from './push.ts';

describe('reminders', () => {
	it('asks an iPhone tab to go to the Home Screen first', () => {
		expect(reminderSupport({ ios: true, standalone: false, push: false })).toBe('install');
		expect(reminderSupport({ ios: true, standalone: true, push: true })).toBe('ready');
		expect(reminderSupport({ ios: false, standalone: false, push: true })).toBe('ready');
		expect(reminderSupport({ ios: false, standalone: false, push: false })).toBe('none');
	});

	it('sends only where to send, the time zone and what to watch', () => {
		const now = Date.parse('2026-11-01T12:00:00Z');
		const body = subscriptionBody(
			{ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'P', auth: 'A' } },
			{
				circle: { id: 'circle123', memberId: 'me12345' },
				pickInvites: [
					{ id: 'open1234', expiresAt: '2026-11-05T00:00:00Z', pickedIndex: null },
					{ id: 'done1234', expiresAt: '2026-11-05T00:00:00Z', pickedIndex: 1 },
					{ id: 'old12345', expiresAt: '2026-10-30T00:00:00Z', pickedIndex: null }
				]
			},
			'America/Chicago',
			now
		);
		expect(body).toEqual({ endpoint: 'https://web.push.apple.com/x', p256dh: 'P', auth: 'A', timeZone: 'America/Chicago', circleId: 'circle123', memberId: 'me12345', invites: ['open1234'] });
	});

	it('never watches the sample family', () => {
		const body = subscriptionBody({ endpoint: 'e' }, { circle: { id: 'sample', memberId: 'me' } }, 'UTC');
		expect(body).not.toHaveProperty('circleId');
	});
});
