"""Fluxo do aplicativo.

Modos (especificação, item 2):
- normal: a janela abre a tela do Gestor do servidor (mesmas telas e regras do web). Um vigia em
  segundo plano renova a cópia da contingência, sincroniza o que ficou pendente e procura atualização.
- sem internet: igual ao normal (banco e API estão na rede da loja). Só CNPJ e WhatsApp esperam.
- contingência: o servidor não responde. O app pergunta se quer entrar; as O.S ficam no SQLite deste
  computador com número provisório e uma faixa fica sempre visível. Quando o servidor volta,
  sincroniza, recebe os números definitivos e imprime o resumo.
"""

import ctypes
import sys
import threading
import time
from pathlib import Path

from . import NOME, VERSAO, atualizacao, config, impressao, sincronizacao
from .base_local import BaseLocal
from .ponte import Ponte
from .servidor import Servidor, ServidorFora

PASTA_WEB = Path(__file__).resolve().parent / "web"
if getattr(sys, "frozen", False):  # PyInstaller: os arquivos ficam em _MEIPASS
    PASTA_WEB = Path(getattr(sys, "_MEIPASS")) / "gestor_os" / "web"

INTERVALO_VIGIA = 20  # segundos entre os testes do servidor
INTERVALO_COPIA = 5 * 60  # renovação da cópia da contingência
INTERVALO_ATUALIZACAO = 60 * 60


def uma_instancia():
    """Só um app por computador (o atalho gestoros:// não abre outra janela)."""
    if sys.platform != "win32":
        return True
    ctypes.windll.kernel32.CreateMutexW(None, False, "Global\\GestorOS-Desktop")
    return ctypes.windll.kernel32.GetLastError() != 183  # ERROR_ALREADY_EXISTS


class App:
    def __init__(self):
        self.cfg = config.ler()
        config.gravar(self.cfg)
        self.base = BaseLocal(config.pasta_dados() / "contingencia.db")
        self.servidor = Servidor(self.cfg.get("servidor", ""), self.cfg["maquina"])
        self.janela = None
        self.modo = "normal"
        self.usuario_ctg = None
        self.ultimo_relatorio = None
        self._falhas = 0
        self._perguntando = False
        self._ultima_copia = 0.0
        self._ultima_atualizacao = 0.0
        self._sincronizando = threading.Lock()

    # ------------------------------------------------------------------ telas

    def url_local(self, pagina):
        return (PASTA_WEB / pagina).as_uri()

    def abrir_tela(self, pagina):
        if self.janela:
            self.janela.load_url(self.url_local(pagina))

    def url_inicial(self):
        if not self.cfg.get("servidor"):
            self.modo = "config"
            return self.url_local("config.html")
        if self.servidor.no_ar():
            self.modo = "normal"
            return f"{self.servidor.base}/"
        self.modo = "fora"
        return self.url_local("servidor-fora.html")

    def iniciar(self):
        import webview  # importa aqui: os testes rodam sem pywebview

        self._webview = webview
        self.janela = webview.create_window(
            f"{NOME} {VERSAO}", self.url_inicial(), js_api=Ponte(self),
            width=1320, height=860, min_size=(960, 620), text_select=True,
        )
        webview.start(
            self._vigia,
            private_mode=False,
            storage_path=str(config.pasta_dados() / "webview"),
            user_agent=f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) GestorOS-Desktop/{VERSAO}",
        )

    # ------------------------------------------------------------------ servidor

    def trocar_servidor(self, url):
        self.cfg["servidor"] = url
        config.gravar(self.cfg)
        self.servidor = Servidor(url, self.cfg["maquina"])
        self.tentar_servidor()

    def tentar_servidor(self):
        if self.servidor.no_ar():
            self.voltar_ao_servidor()
            return True
        return False

    def voltar_ao_servidor(self):
        self.modo = "normal"
        self._falhas = 0
        self.usuario_ctg = None
        self.janela.load_url(f"{self.servidor.base}/")

    def entrar_contingencia(self):
        self.modo = "contingencia"
        self.abrir_tela("contingencia.html")

    def atualizar_cookies(self):
        try:
            self.servidor.definir_cookies(self.janela.get_cookies())
        except Exception:  # noqa: BLE001 - janela fechando
            pass

    # ------------------------------------------------------------------ vigia em segundo plano

    def _vigia(self):
        while True:
            try:
                self._uma_volta()
            except Exception as err:  # noqa: BLE001 - o vigia nunca pode morrer
                print("vigia:", err)
            time.sleep(INTERVALO_VIGIA)

    def _uma_volta(self):
        if self.modo == "config":
            return
        no_ar = self.servidor.no_ar()
        if self.modo == "contingencia" or self.modo == "fora":
            if no_ar:
                self._avisar_tela("window.gestorServidorVoltou && window.gestorServidorVoltou()")
            return
        if not no_ar:
            self._falhas += 1
            if self._falhas >= 2 and not self._perguntando:
                self._perguntar_contingencia()
            return
        self._falhas = 0
        self.atualizar_cookies()
        if not self.servidor.logado():
            return
        agora = time.time()
        if agora - self._ultima_copia > INTERVALO_COPIA:
            self.renovar_copia()
            self._ultima_copia = agora
        if self.base.pendentes():
            rel = self.sincronizar(imprimir_resumo=True)
            if rel.get("conflitos") or rel.get("erros"):
                self.abrir_janela_sync()
        if agora - self._ultima_atualizacao > INTERVALO_ATUALIZACAO:
            self._ultima_atualizacao = agora
            self.procurar_atualizacao()

    def _avisar_tela(self, js):
        try:
            self.janela.evaluate_js(js)
        except Exception:  # noqa: BLE001
            pass

    def _perguntar_contingencia(self):
        self._perguntando = True
        try:
            entrar = self.janela.create_confirmation_dialog(
                "Servidor fora do ar",
                f"Não consegui falar com o servidor ({self.servidor.base}).\n\nDeseja entrar em modo contingência?\n"
                "As O.S ficam neste computador com número provisório e vão para o servidor quando ele voltar.",
            )
            if entrar:
                self.entrar_contingencia()
            else:
                self._falhas = 0
        finally:
            self._perguntando = False

    def renovar_copia(self):
        try:
            r = self.servidor.get("/os/desktop/cache", tempo=120)
        except ServidorFora:
            return False
        if r.get("ok"):
            self.base.guardar_copia(r)
            try:
                self.servidor.post("/desktop/presenca", {"maquina": self.cfg["maquina"], "versao": VERSAO})
            except ServidorFora:
                pass
            return True
        return False

    def sincronizar(self, imprimir_resumo=False):
        if not self._sincronizando.acquire(blocking=False):
            return {"titulo": "Sincronização já em andamento.", "linhas": [], "conflitos": [], "erros": 0}
        try:
            self.atualizar_cookies()
            rel = sincronizacao.sincronizar(self.servidor, self.base)
            self.ultimo_relatorio = rel
            if rel.get("enviadas") or rel.get("conflitos") or rel.get("erros"):
                self.renovar_copia()
                titulo = rel["titulo"].replace('"', "'")
                self._avisar_tela(f'window.showMsg ? window.showMsg("{titulo}") : alert("{titulo}")')
                if imprimir_resumo:
                    self.imprimir_resumo(rel)
            return rel
        finally:
            self._sincronizando.release()

    def imprimir_resumo(self, rel):
        texto = impressao.texto_resumo_sync(rel, self.cfg["maquina"])
        imp = self.cfg.get("impressoras", {})
        try:
            if imp.get("termica"):
                impressao.imprimir_raw(imp["termica"], impressao.escpos(texto), "Sincronização O.S")
            elif imp.get("a4"):
                self.imprimir_html(impressao.html_simples(texto, "Sincronização O.S"), imp["a4"])
        except Exception as err:  # noqa: BLE001 - o resumo também fica na tela de sincronização
            print("resumo:", err)

    def abrir_janela_sync(self):
        self._webview.create_window("Sincronização da contingência", self.url_local("sincronizacao.html"),
                                    js_api=Ponte(self), width=900, height=640)

    def procurar_atualizacao(self):
        nova = atualizacao.verificar(self.servidor)
        if not nova:
            return
        if self.base.pendentes():
            return  # atualiza só depois de sincronizar tudo
        quer = self.janela.create_confirmation_dialog(
            "Atualização disponível",
            f"Há uma versão nova do {NOME} ({nova['versao']}). Atualizar agora? O aplicativo fecha e abre de novo.")
        if quer:
            try:
                atualizacao.baixar_e_instalar(self.servidor)
                self.janela.destroy()
            except Exception as err:  # noqa: BLE001
                self._avisar_tela(f"alert('Não foi possível atualizar: {str(err)[:120]}')")

    # ------------------------------------------------------------------ impressão HTML (A4 / meia folha)

    def imprimir_html(self, html, impressora):
        """Abre uma janela escondida com o HTML e imprime pelo WebView2 na impressora escolhida.
        Sem impressora escolhida (ou se o WebView2 recusar), mostra a janela com o diálogo de impressão."""
        w = self._webview.create_window("Impressão", html=html, hidden=True, width=900, height=1000)

        def carregou():
            if impressora and _imprimir_webview2(w, impressora):
                threading.Timer(20, w.destroy).start()
                return
            w.show()
            w.evaluate_js("window.print()")

        w.events.loaded += carregou
        return True


def _imprimir_webview2(janela, impressora):
    """CoreWebView2.PrintAsync com PrinterName (WebView2 1.0.1518+). Silencioso; False se não der."""
    try:
        from System import Action  # type: ignore  # pythonnet, que o pywebview já usa no Windows

        form = janela.native
        controle = getattr(getattr(form, "browser", None), "webview", None)
        if controle is None:
            return False
        resultado = {"ok": False}

        def no_ui():
            core = controle.CoreWebView2
            ajustes = core.Environment.CreatePrintSettings()
            ajustes.PrinterName = impressora
            ajustes.ShouldPrintBackgrounds = True
            ajustes.ShouldPrintHeaderAndFooter = False
            core.PrintAsync(ajustes)
            resultado["ok"] = True

        form.Invoke(Action(no_ui))
        return resultado["ok"]
    except Exception as err:  # noqa: BLE001
        print("impressão WebView2:", err)
        return False


def main():
    if not uma_instancia():
        return 0
    App().iniciar()
    return 0
