// Propagacao por eventos: so os neuronios que dispararam somam nas sinapses.
void main() {
	uint total = gl_NumWorkGroups.x * gl_WorkGroupSize.x;
	uint count = uint(spk[0]);
	for (uint s = gl_GlobalInvocationID.x; s < count; s += total) {
		uint pre = uint(spk[1 + s]);
		float ws = pc.w_syn * FIX * da[pre].w / (1.0 - STD_U);
		for (uint k = off[pre]; k < off[pre + 1]; k++) atomicAdd(gi[dst[k]], int(float(wsyn[k]) * wmul(k) * ws));
		if ((flags[pre] & 1) != 0)
			for (uint p = poff[pre]; p < poff[pre + 1]; p++) atomicAdd(gi[pdst[p]], int(pw[p] * ws));
	}
}
