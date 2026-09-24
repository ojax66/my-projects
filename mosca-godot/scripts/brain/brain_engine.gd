class_name BrainEngine
extends Node
## Simula os conectomas COMPLETOS na GPU (compute shaders do Godot / Vulkan).
##
## O conectoma (topologia + pesos) e carregado uma vez por especie e
## compartilhado; cada mosca/larva tem o proprio estado (potenciais, taxas,
## tracos) e os proprios pesos plasticos KC->MBON (a memoria dela).
## A cada tick de fisica, todos os cerebros sao gravados numa unica lista de
## comandos, enviados, e as leituras (taxas por grupo, raster, valencia)
## voltam para a CPU.
##
## Sem RenderingDevice (renderizador Compatibility / sem Vulkan) o jogo usa o
## subcircuito em GDScript (FlyBrain), entao `available` fica falso.

const KERNELS := ["spike_integrate", "spike_propagate", "reset", "rate_push", "rate_integrate", "dopamine", "plasticity"]
const WG := 64

static var instance: BrainEngine

var rd: RenderingDevice
var available := false
var pipelines := {}        # kernel -> {shader, pipeline}
var datasets := {}         # tag -> Dictionary
var brains: Array = []     # GpuBrain
var gpu_ms := 0.0


func _init() -> void:
	instance = self
	process_priority = -100
	process_physics_priority = -100


func _ready() -> void:
	if OS.has_feature("no_gpu_brain"):
		return
	rd = RenderingServer.create_local_rendering_device()
	if rd == null:
		push_warning("BrainEngine: sem RenderingDevice; usando os subcircuitos em GDScript")
		return
	var common: String = BrainShaders.COMMON
	for k: String in KERNELS:
		var body: String = BrainShaders.KERNELS[k]
		var src := RDShaderSource.new()
		src.source_compute = "#version 450\nlayout(local_size_x = %d) in;\n%s\n%s" % [WG, common, body.replace("void main() {", "void main() {\n\ttouch_all();")]
		var spirv := rd.shader_compile_spirv_from_source(src)
		if spirv.compile_error_compute != "":
			push_error("BrainEngine: erro no shader %s: %s" % [k, spirv.compile_error_compute])
			return
		var sh := rd.shader_create_from_spirv(spirv, k)
		pipelines[k] = {"shader": sh, "pipeline": rd.compute_pipeline_create(sh)}
	available = true
	print("BrainEngine: GPU %s" % rd.get_device_name())


func has_dataset(tag: String) -> bool:
	return FileAccess.file_exists("res://brain/full/%s.bin.gz" % tag)


## Carrega (uma vez) o conectoma completo de uma especie.
func dataset(tag: String) -> Dictionary:
	if datasets.has(tag):
		return datasets[tag]
	var t0 := Time.get_ticks_msec()
	var meta: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://brain/full/%s.json" % tag))
	var raw := FileAccess.get_file_as_bytes("res://brain/full/%s.bin.gz" % tag)
	var data := raw.decompress_dynamic(-1, FileAccess.COMPRESSION_GZIP)
	var hdr := data.slice(4, 28).to_int32_array()
	var N: int = hdr[1]
	var E: int = hdr[2]
	var P: int = hdr[3]
	var M: int = hdr[4]
	var rows: int = hdr[5]
	var pos := 28
	var parts := {}
	for spec: Array in [["off", N + 1], ["dst", E], ["w", E], ["chan", N], ["out", N], ["disp", N], ["row", N],
			["flags", N], ["poff", N + 1], ["pdst", P], ["pw0", P], ["moff", N + 1], ["mdan", M], ["mw", M]]:
		var bytes: int = int(spec[1]) * 4
		parts[spec[0]] = data.slice(pos, pos + bytes)
		pos += bytes
	var ds := {"tag": tag, "meta": meta, "N": N, "E": E, "P": P, "M": M, "rows": rows,
		"n_out": (meta["outputs"] as Array).size(), "n_disp": (meta["display"] as Array).size(),
		"n_chan": (meta["channels"] as Array).size(), "pw0": (parts["pw0"] as PackedByteArray).to_float32_array()}
	var bufs := []
	for key in ["off", "dst", "w", "chan", "out", "disp", "row", "flags", "poff", "pdst", "pw0", "moff", "mdan", "mw"]:
		var b: PackedByteArray = parts[key]
		if b.is_empty():
			b = PackedByteArray([0, 0, 0, 0])
		bufs.append(rd.storage_buffer_create(b.size(), b))
	ds["buffers"] = bufs
	# membros por grupo (para converter somas em taxas medias)
	var outc := PackedInt32Array()
	outc.resize(ds["n_out"])
	var dispc := PackedInt32Array()
	dispc.resize(ds["n_disp"])
	var out_a := (parts["out"] as PackedByteArray).to_int32_array()
	var disp_a := (parts["disp"] as PackedByteArray).to_int32_array()
	for i in N:
		if out_a[i] >= 0:
			outc[out_a[i]] += 1
		dispc[disp_a[i]] += 1
	ds["out_count"] = outc
	ds["disp_count"] = dispc
	ds["row_disp"] = _row_groups((parts["row"] as PackedByteArray).to_int32_array(), disp_a, rows)
	ds["sets"] = {}
	for k: String in KERNELS:
		var us := []
		for bi in bufs.size():
			var u := RDUniform.new()
			u.uniform_type = RenderingDevice.UNIFORM_TYPE_STORAGE_BUFFER
			u.binding = bi
			u.add_id(bufs[bi])
			us.append(u)
		ds["sets"][k] = rd.uniform_set_create(us, pipelines[k]["shader"], 0)
	datasets[tag] = ds
	print("BrainEngine: %s carregado (%d neuronios, %d sinapses) em %d ms" % [meta["name"], N, E, Time.get_ticks_msec() - t0])
	return ds


func _row_groups(row_a: PackedInt32Array, disp_a: PackedInt32Array, rows: int) -> PackedInt32Array:
	var out := PackedInt32Array()
	out.resize(rows)
	for i in row_a.size():
		if row_a[i] >= 0:
			out[row_a[i]] = disp_a[i]
	return out


func register(b: GpuBrain) -> void:
	brains.append(b)


func unregister(b: GpuBrain) -> void:
	brains.erase(b)


func _physics_process(_dt: float) -> void:
	if not available or brains.is_empty():
		return
	var t0 := Time.get_ticks_usec()
	var active: Array = []
	for b: GpuBrain in brains:
		if b.wants_step():
			b.before_submit()
			active.append(b)
	if active.is_empty():
		return
	var cl := rd.compute_list_begin()
	for b: GpuBrain in active:
		b.record(cl)
	rd.compute_list_end()
	rd.submit()
	rd.sync()
	for b: GpuBrain in active:
		b.after_sync()
	gpu_ms = lerpf(gpu_ms, (Time.get_ticks_usec() - t0) / 1000.0, 0.1)


func dispatch(cl: int, kernel: String, ds: Dictionary, brain_set: RID, groups: int, push: PackedByteArray) -> void:
	rd.compute_list_bind_compute_pipeline(cl, pipelines[kernel]["pipeline"])
	rd.compute_list_bind_uniform_set(cl, ds["sets"][kernel], 0)
	rd.compute_list_bind_uniform_set(cl, brain_set, 1)
	rd.compute_list_set_push_constant(cl, push, push.size())
	rd.compute_list_dispatch(cl, maxi(groups, 1), 1, 1)
	rd.compute_list_add_barrier(cl)
