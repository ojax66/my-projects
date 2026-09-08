/* Stub do @minecraft/server-ui.
 *
 * Os testes não clicam em botão nenhum — o que eles precisam é que os módulos
 * que importam formulários CARREGUEM, e que dê pra checar o que seria mostrado
 * sem abrir nada. `show()` devolve "cancelado" por padrão; um teste que queira
 * simular um clique põe a resposta em __queue.
 */
export const __shown = [];
export const __queue = [];

class Form {
  constructor(kind) {
    this.kind = kind;
    this.buttons = [];
    this.titleText = "";
    this.bodyText = "";
  }
  title(t) { this.titleText = t; return this; }
  body(t) { this.bodyText = t; return this; }
  button(label, icon) { this.buttons.push({ label, icon }); return this; }
  async show(player) {
    __shown.push({ kind: this.kind, player: player?.id, form: this });
    const next = __queue.shift();
    if (next !== undefined) return { canceled: false, selection: next };
    return { canceled: true, cancelationReason: "UserBusy" };
  }
}

export class ActionFormData extends Form {
  constructor() { super("action"); }
}
export class MessageFormData extends Form {
  constructor() { super("message"); }
  button1(l) { return this.button(l); }
  button2(l) { return this.button(l); }
}
export class ModalFormData extends Form {
  constructor() { super("modal"); }
  toggle(label, value) { this.buttons.push({ label, value }); return this; }
  dropdown(label, opts) { this.buttons.push({ label, opts }); return this; }
  textField(label) { this.buttons.push({ label }); return this; }
  slider(label) { this.buttons.push({ label }); return this; }
}
export const FormCancelationReason = { UserBusy: "UserBusy", UserClosed: "UserClosed" };

export default { ActionFormData, MessageFormData, ModalFormData, FormCancelationReason };
