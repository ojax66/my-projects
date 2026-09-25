class_name AmphibianOrgans
extends RefCounted
## Fisiologia de orgaos de um anfibio (ra ou girino), ligada ao conectoma:
##
##   coracao   bate de verdade: a frequencia sai do simpatico (coracao_acelera)
##             e do vago (coracao_freia) do conectoma, e da temperatura
##             (ectotermo). Cada batida manda sangue: sem batida, sem oxigenio
##             chegando aos musculos.
##   pulmoes   so enchem quando a bomba bucal (saida "respirar" do gerador
##             respiratorio) empurra ar da garganta para dentro, e so com a
##             narina fora d'agua. Pulmao cheio -> receptores de estiramento.
##   pele      respiracao cutanea (importante na ra; depende da pele umida e
##             funciona melhor na agua)
##   branquias girino: a mesma bomba bucal passa agua pelas branquias
##   sangue    O2 (saturacao 0..1): cai com o trabalho muscular; baixo ->
##             quimiorreceptores (oxigenio_baixo) -> respira mais
##   estomago  guarda a presa/algas; digere aos poucos para o figado/corpo
##             gorduroso (energia); o resto vai para o intestino e sai (fezes)

var heart_rate := 40.0        # batidas por minuto
var beat_phase := 0.0         # 0..1 dentro do ciclo cardiaco
var beat_now := 0.0           # 0..1 (sistole) para desenhar
var beats := 0
var o2 := 0.95                # saturacao do sangue
var lung := 0.4               # volume do pulmao 0..1
var buccal := 0.0             # posicao do assoalho da boca (garganta) -1..1
var _buccal_ph := 0.0
var stomach := 0.0            # conteudo (unidades de energia)
var stomach_items := 0        # presas inteiras ainda no estomago
var intestine := 0.0
var feces := 0.0
var has_lungs := true
var has_gills := false
var work := 0.0               # trabalho muscular agora (0..1+)
var cause_of_failure := ""


## Um passo. brain: GpuBrain/FlyBrain. surface_air: a narina esta fora d'agua.
## in_water: pele/branquias na agua. skin_moist: 0..1. temp_c: temperatura.
## Retorna a energia digerida neste passo.
func step(dt: float, brain, surface_air: bool, in_water: bool, skin_moist: float, temp_c: float) -> float:
	# ---- coracao
	var acc: float = brain.output("coracao_acelera") if brain.has_output("coracao_acelera") else 0.0
	var brk: float = brain.output("coracao_freia") if brain.has_output("coracao_freia") else 0.0
	var q10 := pow(2.0, (temp_c - 20.0) / 10.0)
	var target := (30.0 + 25.0 * work) * q10 * (1.0 + 1.2 * acc) * (1.0 - 0.5 * clampf(brk, 0.0, 1.0))
	target += 20.0 * (1.0 - o2)      # falta de O2 tambem acelera (reflexo)
	heart_rate = lerpf(heart_rate, clampf(target, 8.0, 160.0), 1.0 - exp(-dt / 3.0))
	beat_phase += dt * heart_rate / 60.0
	if beat_phase >= 1.0:
		beat_phase -= floor(beat_phase)
		beats += 1
	beat_now = exp(-pow((beat_phase - 0.1) / 0.08, 2.0))
	var perfusion := clampf(heart_rate / 40.0, 0.2, 2.0)
	# ---- bomba bucal (garganta) e pulmoes
	var resp: float = brain.output("respirar") if brain.has_output("respirar") else (1.0 - o2) * 2.0
	var pump_hz := clampf(0.5 + resp * 4.0, 0.3, 6.0)
	var prev := buccal
	_buccal_ph += dt * pump_hz
	buccal = sin(_buccal_ph * TAU) * clampf(0.3 + resp, 0.3, 1.0)
	var breath_in := 0.0
	if has_lungs and surface_air and buccal < prev and buccal < 0.0:
		# assoalho da boca subindo com a narina fechada: ar vai para o pulmao
		lung = minf(1.0, lung + (prev - buccal) * 0.25)
		breath_in = (prev - buccal)
	lung = maxf(0.0, lung - dt * 0.02 * (1.0 + work))   # o ar do pulmao e usado / sai
	# ---- trocas de O2
	var uptake := 0.0
	if has_lungs:
		uptake += lung * 0.05 * (1.0 if surface_air or lung > 0.1 else 0.0)
	uptake += skin_moist * (0.03 if in_water else 0.012)            # pele
	if has_gills and in_water:
		uptake += 0.07 * clampf(0.3 + absf(buccal), 0.0, 1.3)       # branquias
	var use := 0.012 * (1.0 + 4.0 * work) * q10
	o2 = clampf(o2 + (uptake * perfusion * (1.0 - o2) * 2.0 - use) * dt, 0.0, 1.0)
	work = maxf(0.0, work - dt * 1.5)
	# ---- digestao
	var d := minf(stomach, dt * 0.0004 * q10)
	stomach -= d
	intestine += d * 0.3
	if stomach < 0.02 * stomach_items:
		stomach_items = maxi(0, stomach_items - 1)
	var e := d * 0.7
	var ex := minf(intestine, dt * 0.0004)
	intestine -= ex
	feces += ex
	return e + 0.0 * breath_in


func eat(energy_units: float, whole := true) -> void:
	stomach += energy_units
	if whole:
		stomach_items += 1


## Sinais para o conectoma (Hz).
func brain_inputs() -> Dictionary:
	return {"oxigenio_baixo": clampf((0.9 - o2) * 400.0, 0.0, 200.0), "pulmao_cheio": 150.0 * lung}


func summary() -> String:
	return "coracao %d bpm  O2 %d%%  pulmao %d%%  estomago %.2f (%d presa)  intestino %.2f" % [
		int(heart_rate), int(o2 * 100), int(lung * 100), stomach, stomach_items, intestine]
