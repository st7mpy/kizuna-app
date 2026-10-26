// @ts-nocheck -- runs in AudioWorkletGlobalScope, which the app typings do not describe.
// Kizuna mic tap. Runs on the audio thread: copies mic frames (mono, device rate) into
// ~40 ms blocks and posts them with their RMS level. Resampling and PCM16 encoding happen
// on the main thread in pcm.ts, so the same code serves the ScriptProcessor fallback and tests.
const BLOCK = 2048;

class KizunaPcmTap extends AudioWorkletProcessor {
	constructor() {
		super();
		this.block = new Float32Array(BLOCK);
		this.filled = 0;
		this.on = true;
		this.port.onmessage = (e) => {
			if (e.data !== 'stop') return;
			// Hand over the last partial block, then tell the main thread we are done.
			if (this.filled > 0) {
				const samples = this.block.slice(0, this.filled);
				let sum = 0;
				for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
				this.port.postMessage({ samples, rms: Math.sqrt(sum / samples.length) }, [samples.buffer]);
				this.filled = 0;
			}
			this.port.postMessage({ done: true });
			this.on = false;
		};
	}

	process(inputs) {
		if (!this.on) return false;
		const input = inputs[0];
		if (input && input.length > 0) {
			const chans = input.length;
			const n = input[0].length;
			for (let i = 0; i < n; i++) {
				let s = 0;
				for (let c = 0; c < chans; c++) s += input[c][i];
				this.block[this.filled++] = s / chans;
				if (this.filled === BLOCK) this.flush();
			}
		}
		return true;
	}

	flush() {
		const samples = this.block;
		let sum = 0;
		for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
		this.port.postMessage({ samples, rms: Math.sqrt(sum / samples.length) }, [samples.buffer]);
		this.block = new Float32Array(BLOCK);
		this.filled = 0;
	}
}

registerProcessor('kizuna-pcm-tap', KizunaPcmTap);
