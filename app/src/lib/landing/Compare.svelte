<script lang="ts">
	// Kizuna next to the three kinds of apps people already use for this.
	// A table on wide screens; one block per question on phones.
	const cols = [
		{ name: 'Kizuna', sub: '' },
		{ name: 'Location trackers', sub: 'Life360 and similar' },
		{ name: 'Personal CRMs', sub: 'Dex, Clay, UpHabit, Monica' },
		{ name: 'Group calendars', sub: 'Howbout, TimeTree, Doodle' }
	];
	const rows: { q: string; a: [string, string, string, string] }[] = [
		{
			q: 'What it tells you',
			a: ['Who’s free to talk, and a reason to', 'Where someone is right now', 'Who is due a catch-up', 'When a group overlaps']
		},
		{
			q: 'What you put in',
			a: ['A voice note, the way you think', 'Everyone’s location, all day', 'Contacts, tags and a timer per person', 'Everyone’s calendar, or a poll']
		},
		{
			q: 'What your family does',
			a: ['Taps a link in WhatsApp. No app', 'Installs it and shares location', 'Nothing. It’s only for you', 'Installs it, or fills in the poll']
		},
		{
			q: 'How it nudges',
			a: ['Only with a reason and a free time, plus a ready line', 'Alerts when someone arrives or leaves', 'On a timer, then an overdue list', 'It doesn’t. Someone has to start']
		},
		{
			q: 'Counts and scores',
			a: ['None. No streaks or “days since”', 'Location history', 'Overdue lists and timers', 'None']
		},
		{
			q: 'Location',
			a: ['Never collected', 'It’s the product', 'Not used', 'Not used']
		}
	];
</script>

<div class="cmp">
	<table class="wide">
		<thead>
			<tr>
				<th scope="col"><span class="sr-only">Question</span></th>
				{#each cols as c, i (c.name)}
					<th scope="col" class:us={i === 0}>
						<span class="cn">{c.name}</span>
						{#if c.sub}<span class="cs">{c.sub}</span>{/if}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.q)}
				<tr>
					<th scope="row">{r.q}</th>
					{#each r.a as a, i (i)}
						<td class:us={i === 0}>{a}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	<div class="narrow">
		{#each rows as r (r.q)}
			<section class="blk">
				<h3>{r.q}</h3>
				<p class="mine"><span class="who">Kizuna</span>{r.a[0]}</p>
				<dl>
					{#each r.a.slice(1) as a, i (i)}
						<div>
							<dt>{cols[i + 1].name}</dt>
							<dd>{a}</dd>
						</div>
					{/each}
				</dl>
			</section>
		{/each}
	</div>
</div>

<style>
	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		table-layout: fixed;
		font-size: var(--t-small);
	}
	th,
	td {
		text-align: left;
		vertical-align: top;
		padding: 18px 18px;
		border-bottom: 1px solid var(--line);
		line-height: 1.4;
	}
	thead th {
		border-bottom: 2px solid var(--rule);
		padding-top: 22px;
	}
	tbody th {
		font-size: var(--t-label);
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
		padding-left: 0;
		padding-top: 21px;
		width: 17%;
	}
	td {
		color: var(--text-2);
	}
	.cn {
		display: block;
		font-size: 1.0625rem;
		font-weight: 500;
		color: var(--text);
		letter-spacing: -0.01em;
	}
	.cs {
		display: block;
		margin-top: 2px;
		font-size: 0.8125rem;
		font-weight: 400;
		color: var(--text-3);
	}
	.us {
		background: var(--accent-soft);
		color: var(--text);
		font-weight: 500;
	}
	thead .us {
		border-radius: 18px 18px 0 0;
	}
	thead .us .cn {
		font-family: var(--serif);
		font-style: italic;
		font-weight: 400;
		font-size: 1.625rem;
		line-height: 1;
		color: var(--accent-ink);
	}
	tbody tr:last-child .us {
		border-radius: 0 0 18px 18px;
	}
	tbody tr:last-child th,
	tbody tr:last-child td {
		border-bottom: 0;
	}
	.narrow {
		display: none;
	}
	@media (max-width: 860px) {
		.wide {
			display: none;
		}
		.narrow {
			display: grid;
			gap: 14px;
		}
	}
	.blk {
		padding: 20px 0 6px;
		border-top: 1px solid var(--line);
	}
	.blk h3 {
		margin-bottom: 12px;
	}
	.mine {
		display: grid;
		gap: 2px;
		padding: 14px 16px;
		border-radius: 16px;
		background: var(--accent-soft);
		font-weight: 500;
		line-height: 1.35;
	}
	.mine .who {
		font-family: var(--serif);
		font-style: italic;
		font-weight: 400;
		font-size: 1.25rem;
		color: var(--accent-ink);
	}
	dl {
		margin: 10px 0 0;
		display: grid;
		gap: 0;
	}
	dl div {
		display: grid;
		grid-template-columns: 9.5em 1fr;
		gap: 12px;
		padding: 9px 0;
		border-bottom: 1px solid var(--line);
		font-size: var(--t-small);
	}
	dl div:last-child {
		border-bottom: 0;
	}
	dt {
		color: var(--text-3);
	}
	dd {
		margin: 0;
		color: var(--text-2);
	}
</style>
