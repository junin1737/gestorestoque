package com.mtautomacoes.gestorestoque;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.android.material.floatingactionbutton.FloatingActionButton;
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
    private PermissionRequest pendingPermissionRequest;

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
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        connectPanel = findViewById(R.id.connect_panel);
        browserPanel = findViewById(R.id.browser_panel);
        urlInput = findViewById(R.id.url_input);
        progress = findViewById(R.id.progress);
        status = findViewById(R.id.status);
        Button btnConnect = findViewById(R.id.btn_connect);
        Button btnScanQr = findViewById(R.id.btn_scan_qr);
        Button btnChange = findViewById(R.id.btn_change_server);
        Button btnScanProduct = findViewById(R.id.btn_scan_product);
        FloatingActionButton fabScan = findViewById(R.id.fab_scan_barcode);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        boolean firstConnection = !prefs.contains(KEY_URL);
        String saved = prefs.getString(KEY_URL, "");
        if (!saved.isEmpty()) {
            urlInput.setText(saved);
        }

        setupWebView();

        View.OnClickListener openBarcode = v -> startBarcodeScan();
        btnScanQr.setOnClickListener(v -> startQrScan());
        btnConnect.setOnClickListener(v -> connect());
        btnChange.setOnClickListener(v -> showConnectPanel());
        btnScanProduct.setOnClickListener(openBarcode);
        fabScan.setOnClickListener(openBarcode);

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
                if (browserPanel.getVisibility() == View.VISIBLE && webView.canGoBack()) {
                    webView.goBack();
                } else if (browserPanel.getVisibility() == View.VISIBLE) {
                    showConnectPanel();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
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
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.CAMERA},
                    REQ_CAMERA_BARCODE
            );
            return;
        }
        ScanOptions options = new ScanOptions();
        options.setDesiredBarcodeFormats(Arrays.asList(
                ScanOptions.EAN_13,
                ScanOptions.EAN_8,
                ScanOptions.UPC_A,
                ScanOptions.UPC_E,
                ScanOptions.CODE_128,
                ScanOptions.CODE_39,
                ScanOptions.ITF,
                ScanOptions.QR_CODE
        ));
        options.setPrompt(getString(R.string.scan_barcode_hint));
        options.setBeepEnabled(true);
        options.setOrientationLocked(true);
        options.setCaptureActivity(PortraitCaptureActivity.class);
        options.setBarcodeImageEnabled(false);
        options.addExtra(Intents.Scan.SCAN_TYPE, Intents.Scan.MIXED_SCAN);
        barcodeLauncher.launch(options);
    }

    private void deliverBarcodeToWeb(String raw) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("code", raw);
            final String js = "(function(p){"
                    + "var c=p&&p.code;"
                    + "if(!c)return;"
                    + "if(typeof window.applyScannedCodeFromApp==='function'){"
                    + "  window.applyScannedCodeFromApp(c);return;"
                    + "}"
                    + "var inp=document.getElementById('estoque-busca');"
                    + "if(inp){inp.value=c;inp.dispatchEvent(new Event('input',{bubbles:true}));"
                    + "  var btn=document.getElementById('btn-buscar-estoque');"
                    + "  if(btn)btn.click();}"
                    + "})(" + payload + ");";
            webView.post(() -> webView.evaluateJavascript(js, null));
            Toast.makeText(this, "Código: " + raw, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Lido, mas falhou ao enviar ao painel: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void injectNativeHooks(WebView view) {
        // Garante ponte nativa mesmo se o JS do painel estiver em cache antigo
        String js = "(function(){"
                + "window.__GESTOR_APP__=true;"
                + "function openNative(e){"
                + "  try{"
                + "    if(e){e.preventDefault();e.stopImmediatePropagation();}"
                + "    if(window.GestorApp){window.GestorApp.scanBarcode();}"
                + "  }catch(err){}"
                + "  return false;"
                + "}"
                + "var btn=document.getElementById('btn-scan-barras');"
                + "if(btn && !btn.__gestorNativeBound){"
                + "  btn.__gestorNativeBound=true;"
                + "  btn.addEventListener('click',openNative,true);"
                + "}"
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
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
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
                startBarcodeScan();
            });
        }

        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }
    }
}
