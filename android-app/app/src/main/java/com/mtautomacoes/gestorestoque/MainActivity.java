package com.mtautomacoes.gestorestoque;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.google.zxing.client.android.Intents;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

import org.json.JSONObject;

import java.util.Arrays;

public class MainActivity extends AppCompatActivity {
    private static final String PREFS = "gestor_prefs";
    private static final String KEY_URL = "server_url";
    private static final int REQ_CAMERA_WEB = 1001;
    private static final int REQ_CAMERA_QR = 1002;
    private static final int REQ_CAMERA_BARCODE = 1003;

    private WebView webView;
    private View connectPanel;
    private View browserPanel;
    private EditText urlInput;
    private ProgressBar progress;
    private TextView status;
    private ImageView imgEmitente;
    private TextView txtEmpresa;
    private PermissionRequest pendingPermissionRequest;
    private String pendingBarcodeMode = "product";

    private final ActivityResultLauncher<ScanOptions> qrLauncher =
            registerForActivityResult(new ScanContract(), result -> {
                if (result.getContents() == null) {
                    Toast.makeText(this, R.string.scan_canceled, Toast.LENGTH_SHORT).show();
                    return;
                }
                String url = normalizeUrl(result.getContents());
                if (url == null) {
                    Toast.makeText(this, R.string.invalid_qr, Toast.LENGTH_LONG).show();
                    return;
                }
                urlInput.setText(url);
                connectWithUrl(url);
            });

    private final ActivityResultLauncher<ScanOptions> barcodeLauncher =
            registerForActivityResult(new ScanContract(), result -> {
                if (result.getContents() == null) {
                    Toast.makeText(this, R.string.scan_canceled, Toast.LENGTH_SHORT).show();
                    return;
                }
                deliverBarcodeToWeb(result.getContents());
            });

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        setContentView(R.layout.activity_main);
        applySystemBarAppearance(getResources().getColor(R.color.brand, getTheme()), false);

        webView = findViewById(R.id.webview);
        connectPanel = findViewById(R.id.connect_panel);
        browserPanel = findViewById(R.id.browser_panel);
        urlInput = findViewById(R.id.url_input);
        progress = findViewById(R.id.progress);
        status = findViewById(R.id.status);
        imgEmitente = findViewById(R.id.img_emitente);
        txtEmpresa = findViewById(R.id.txt_empresa);
        Button btnConnect = findViewById(R.id.btn_connect);
        Button btnScanQr = findViewById(R.id.btn_scan_qr);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        boolean firstConnection = !prefs.contains(KEY_URL);
        String saved = prefs.getString(KEY_URL, "");
        if (!saved.isEmpty()) {
            urlInput.setText(saved);
        }

        setupWebView();
        EmitenteIcon.restore(this, imgEmitente, txtEmpresa);

        btnScanQr.setOnClickListener(v -> startQrScan());
        btnConnect.setOnClickListener(v -> connect());

        urlInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO
                    || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER
                    && event.getAction() == KeyEvent.ACTION_DOWN)) {
                connect();
                return true;
            }
            return false;
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (browserPanel.getVisibility() != View.VISIBLE) {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    return;
                }
                webView.evaluateJavascript(
                        "(function(){try{"
                                + "if(typeof window.gestorHardwareBack==='function'&&window.gestorHardwareBack())return true;"
                                + "return false;"
                                + "}catch(e){return false;}})();",
                        value -> {
                            boolean handled = "true".equals(value);
                            if (handled) return;
                            runOnUiThread(() -> {
                                if (webView.canGoBack()) {
                                    webView.goBack();
                                } else {
                                    showConnectPanel();
                                }
                            });
                        }
                );
            }
        });

        if (firstConnection) {
            status.setText(R.string.hint_connect);
            connectPanel.post(this::startQrScan);
        } else if (!saved.isEmpty()) {
            connectWithUrl(saved);
        }
    }

    private void startQrScan() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.CAMERA},
                    REQ_CAMERA_QR
            );
            return;
        }
        ScanOptions options = new ScanOptions();
        options.setDesiredBarcodeFormats(ScanOptions.QR_CODE);
        options.setPrompt(getString(R.string.scan_qr_hint));
        options.setBeepEnabled(false);
        options.setOrientationLocked(true);
        options.setCaptureActivity(PortraitCaptureActivity.class);
        options.addExtra(Intents.Scan.SCAN_TYPE, Intents.Scan.MIXED_SCAN);
        qrLauncher.launch(options);
    }

    private void startBarcodeScan() {
        startBarcodeScan(pendingBarcodeMode);
    }

    /**
     * Leitura nativa rápida.
     * - product / ficha / ean: EAN/UPC (sem QR, sem MIXED — mais ágil)
     * - importacao (chave NF-e): CODE_128/ITF, orientação livre
     */
    private void startBarcodeScan(String mode) {
        String m = mode == null ? "product" : mode.trim().toLowerCase();
        pendingBarcodeMode = m;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.CAMERA},
                    REQ_CAMERA_BARCODE
            );
            return;
        }

        boolean chave = "importacao".equals(m) || "chave".equals(m);
        ScanOptions options = new ScanOptions();
        if (chave) {
            options.setDesiredBarcodeFormats(Arrays.asList(
                    ScanOptions.CODE_128,
                    ScanOptions.ITF,
                    ScanOptions.CODE_39,
                    ScanOptions.CODABAR
            ));
            options.setPrompt("Chave NF-e — enquadre a barra na horizontal");
            options.setOrientationLocked(false);
            options.setBeepEnabled(true);
            options.setBarcodeImageEnabled(false);
            options.addExtra(Intents.Scan.SCAN_TYPE, Intents.Scan.MIXED_SCAN);
        } else {
            options.setDesiredBarcodeFormats(Arrays.asList(
                    ScanOptions.EAN_13,
                    ScanOptions.EAN_8,
                    ScanOptions.UPC_A,
                    ScanOptions.UPC_E,
                    ScanOptions.CODE_128,
                    ScanOptions.CODE_39
            ));
            options.setPrompt(getString(R.string.scan_barcode_hint));
            options.setOrientationLocked(true);
            options.setBeepEnabled(true);
            options.setBarcodeImageEnabled(false);
            // NORMAL (não MIXED): MIXED tenta invertido e deixa a leitura lenta no APK
            options.addExtra(Intents.Scan.SCAN_TYPE, Intents.Scan.NORMAL_SCAN);
        }
        options.setCaptureActivity(PortraitCaptureActivity.class);
        barcodeLauncher.launch(options);
    }

    private void deliverBarcodeToWeb(String raw) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("code", raw);
            final String js = "(function(p){"
                    + "var raw=p&&p.code;if(!raw)return;"
                    + "var digits=String(raw).replace(/\\D/g,'');"
                    + "var chave=digits.length>=44?digits.slice(0,44):'';"
                    + "if(typeof window.applyScannedCodeFromApp==='function'){"
                    + "  if(window.applyScannedCodeFromApp(chave||raw))return;"
                    + "}"
                    + "if(chave.length===44){"
                    + "  var inp=document.getElementById('imp-chave');"
                    + "  if(inp){inp.value=chave;"
                    + "    if(window.ImportacaoNfe&&typeof ImportacaoNfe.applyScannedChave==='function'"
                    + "        &&ImportacaoNfe.applyScannedChave(chave))return;"
                    + "    var btn=document.getElementById('imp-btn-consultar');"
                    + "    if(btn)btn.click();return;}"
                    + "}"
                    + "var inp=document.getElementById('estoque-busca');"
                    + "if(inp){inp.value=raw;inp.dispatchEvent(new Event('input',{bubbles:true}));"
                    + "  var btn=document.getElementById('btn-buscar-estoque');"
                    + "  if(btn)btn.click();}"
                    + "})(" + payload + ");";
            webView.post(() -> webView.evaluateJavascript(js, null));
            Toast.makeText(this, chaveLabel(raw), Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Lido, mas falhou ao enviar ao painel: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private static String chaveLabel(String raw) {
        String digits = raw == null ? "" : raw.replaceAll("\\D", "");
        if (digits.length() >= 44) return "Chave NF-e lida";
        return "Código: " + raw;
    }

    private void applySystemBarAppearance(int color, boolean lightIcons) {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(lightIcons);
            controller.setAppearanceLightNavigationBars(lightIcons);
        }
        getWindow().setStatusBarColor(color);
    }

    private static boolean isColorLight(int color) {
        double r = Color.red(color) / 255.0;
        double g = Color.green(color) / 255.0;
        double b = Color.blue(color) / 255.0;
        double luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return luminance > 0.62;
    }

    private void injectNativeHooks(WebView view) {
        // Garante ponte nativa mesmo se o JS do painel estiver em cache antigo
        String js = "(function(){"
                + "window.__GESTOR_APP__=true;"
                + "if(!document.__gestorScanDelegate){"
                + "  document.__gestorScanDelegate=true;"
                + "  document.addEventListener('click',function(e){"
                + "    var n=e.target,t=null;"
                + "    while(n&&n!==document){"
                + "      if(n.id==='btn-scan-barras'||n.id==='btn-scan-ficha-barras'"
                + "||n.id==='imp-btn-scan-chave'||n.id==='imp-btn-scan-prod'||n.id==='imp-btn-scan-ean'){t=n;break;}"
                + "      n=n.parentElement||n.parentNode;"
                + "    }"
                + "    if(!t||t.disabled)return;"
                + "    e.preventDefault();e.stopImmediatePropagation();"
                + "    var tgt='search';"
                + "    if(t.id==='btn-scan-ficha-barras')tgt='ficha';"
                + "    else if(t.id==='imp-btn-scan-chave')tgt='importacao';"
                + "    else if(t.id==='imp-btn-scan-prod')tgt='importacao-prod';"
                + "    else if(t.id==='imp-btn-scan-ean')tgt='importacao-ean';"
                + "    if(typeof window.setGestorScanTarget==='function')window.setGestorScanTarget(tgt);"
                + "    try{"
                + "      if(window.GestorApp){"
                + "        if(typeof window.GestorApp.scanBarcodeFor==='function')window.GestorApp.scanBarcodeFor(tgt);"
                + "        else if(typeof window.GestorApp.scanBarcode==='function')window.GestorApp.scanBarcode();"
                + "      }"
                + "    }catch(err){}"
                + "  },true);"
                + "}"
                + "var cfg=document.getElementById('btn-config-servidor');"
                + "if(cfg)cfg.hidden=false;"
                + "var m=document.querySelector('meta[name=viewport]');"
                + "if(m)m.setAttribute('content','width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');"
                + "})();";
        view.evaluateJavascript(js, null);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.clearCache(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setTextZoom(100);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.addJavascriptInterface(new GestorJsBridge(), "GestorApp");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progress.setVisibility(View.VISIBLE);
                status.setText(R.string.loading);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                status.setText("");
                injectNativeHooks(view);
                // Reaplica após o app.js registrar listeners
                view.postDelayed(() -> injectNativeHooks(view), 600);
                String server = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, "");
                if (!server.isEmpty()) {
                    EmitenteIcon.fetchFromServer(MainActivity.this, imgEmitente, txtEmpresa, server);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    progress.setVisibility(View.GONE);
                    status.setText(getString(R.string.load_error, error.getDescription()));
                    Toast.makeText(MainActivity.this, R.string.toast_offline, Toast.LENGTH_LONG).show();
                    showConnectPanel();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setCancelable(true)
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean needsCamera = false;
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                                || PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                            needsCamera = true;
                            break;
                        }
                    }
                    if (!needsCamera) {
                        request.grant(request.getResources());
                        return;
                    }
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                    } else {
                        pendingPermissionRequest = request;
                        ActivityCompat.requestPermissions(
                                MainActivity.this,
                                new String[]{Manifest.permission.CAMERA},
                                REQ_CAMERA_WEB
                        );
                    }
                });
            }

            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
                progress.setProgress(newProgress);
            }
        });
    }

    private void connect() {
        String raw = urlInput.getText() != null ? urlInput.getText().toString().trim() : "";
        String url = normalizeUrl(raw);
        if (url == null) {
            Toast.makeText(this, R.string.invalid_url, Toast.LENGTH_SHORT).show();
            return;
        }
        connectWithUrl(url);
    }

    private void connectWithUrl(String url) {
        urlInput.setText(url);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, url).apply();
        EmitenteIcon.fetchFromServer(this, imgEmitente, txtEmpresa, url);
        connectPanel.setVisibility(View.GONE);
        browserPanel.setVisibility(View.VISIBLE);
        status.setText(R.string.loading);
        webView.loadUrl(url);
    }

    private void showConnectPanel() {
        webView.stopLoading();
        browserPanel.setVisibility(View.GONE);
        connectPanel.setVisibility(View.VISIBLE);
        status.setText(R.string.hint_connect);
    }

    private String normalizeUrl(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        String value = raw.trim();
        if (!value.matches("(?i)^https?://.*")) {
            value = "http://" + value;
        }
        try {
            java.net.URI uri = java.net.URI.create(value);
            String host = uri.getHost();
            if (host == null || host.isEmpty()) return null;
            int port = uri.getPort();
            String path = uri.getPath();
            if (path == null || path.isEmpty()) path = "/";
            if (port < 0) {
                return uri.getScheme() + "://" + host + ":5077" + (path.equals("/") ? "/" : path);
            }
            return uri.getScheme() + "://" + host + ":" + port + (path.equals("/") ? "/" : path);
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_CAMERA_QR) {
            if (granted) startQrScan();
            else Toast.makeText(this, R.string.camera_denied, Toast.LENGTH_LONG).show();
            return;
        }
        if (requestCode == REQ_CAMERA_BARCODE) {
            if (granted) startBarcodeScan();
            else Toast.makeText(this, R.string.camera_denied, Toast.LENGTH_LONG).show();
            return;
        }
        if (requestCode == REQ_CAMERA_WEB && pendingPermissionRequest != null) {
            if (granted) {
                pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
            } else {
                pendingPermissionRequest.deny();
                Toast.makeText(this, R.string.camera_denied, Toast.LENGTH_LONG).show();
            }
            pendingPermissionRequest = null;
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    private class GestorJsBridge {
        @JavascriptInterface
        public void scanBarcode() {
            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, R.string.scan_barcode_hint, Toast.LENGTH_SHORT).show();
                startBarcodeScan("product");
            });
        }

        /** target: search|ficha|importacao|importacao-prod|importacao-ean */
        @JavascriptInterface
        public void scanBarcodeFor(String target) {
            final String mode = target == null ? "product" : target;
            runOnUiThread(() -> {
                boolean chave = "importacao".equalsIgnoreCase(mode);
                Toast.makeText(
                        MainActivity.this,
                        chave ? "Leitura da chave NF-e" : getString(R.string.scan_barcode_hint),
                        Toast.LENGTH_SHORT
                ).show();
                startBarcodeScan(mode);
            });
        }

        @JavascriptInterface
        public void setStatusBarColor(String hex) {
            runOnUiThread(() -> {
                try {
                    int color = Color.parseColor(hex);
                    applySystemBarAppearance(color, isColorLight(color));
                } catch (Exception ignored) {
                    /* ignore */
                }
            });
        }

        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @JavascriptInterface
        public void changeServer() {
            runOnUiThread(MainActivity.this::showConnectPanel);
        }

        @JavascriptInterface
        public void setEmitente(String nome, String logoDataUrl) {
            runOnUiThread(() -> EmitenteIcon.applyFromJs(
                    MainActivity.this, imgEmitente, txtEmpresa, nome, logoDataUrl));
        }

        @JavascriptInterface
        public void printHtml(String title, String html) {
            final String t = (title == null || title.isEmpty()) ? "relatorio" : title;
            final String h = html == null ? "" : html;
            runOnUiThread(() -> {
                WebView printer = new WebView(MainActivity.this);
                printer.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                        if (pm == null) return;
                        pm.print(t, view.createPrintDocumentAdapter(t),
                                new PrintAttributes.Builder().build());
                    }
                });
                printer.loadDataWithBaseURL("https://local/", h, "text/html", "UTF-8", null);
            });
        }

        @JavascriptInterface
        public void shareText(String title, String text) {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(send, title));
        }
    }
}
