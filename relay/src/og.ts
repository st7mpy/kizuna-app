// Open Graph tags, so a pasted link unfurls as a card in WhatsApp (and most chats).
// Crawlers fetch the URL without the #fragment, so these never carry the circle key or a name.
import { escapeHtml } from './http.ts';

export const OG_INVITE_IMAGE = '/og-invite.png';
export const FAMILY_OG = {
	title: 'Family call this weekend?',
	description: 'Tap the times that work for you. Takes ten seconds, nothing to install.'
} as const;

/** The public https origin for absolute links in tags (plain http only on localhost). */
export function ogOrigin(req: Request): string {
	const url = new URL(req.url);
	const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	return local ? url.origin : `https://${url.host}`;
}

export function ogTags(o: { title: string; description: string; url: string; image: string }): string {
	const t = escapeHtml(o.title);
	const d = escapeHtml(o.description);
	return [
		`<meta name="description" content="${d}">`,
		'<meta property="og:type" content="website">',
		'<meta property="og:site_name" content="Kizuna">',
		`<meta property="og:title" content="${t}">`,
		`<meta property="og:description" content="${d}">`,
		`<meta property="og:url" content="${escapeHtml(o.url)}">`,
		`<meta property="og:image" content="${escapeHtml(o.image)}">`,
		'<meta property="og:image:type" content="image/png">',
		'<meta property="og:image:width" content="1200">',
		'<meta property="og:image:height" content="630">',
		`<meta property="og:image:alt" content="${t}">`,
		'<meta name="twitter:card" content="summary_large_image">',
		`<meta name="twitter:title" content="${t}">`,
		`<meta name="twitter:description" content="${d}">`,
		`<meta name="twitter:image" content="${escapeHtml(o.image)}">`
	].join('\n');
}
