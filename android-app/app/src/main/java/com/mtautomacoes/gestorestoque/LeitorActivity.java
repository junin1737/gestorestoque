package com.mtautomacoes.gestorestoque;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Bundle;
import android.util.Size;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.ZoomState;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.ZoomSuggestionOptions;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Leitor de código de barras com caixa de foco (ML Kit + CameraX).
 * Modo "produto": EAN/UPC/CODE_128/CODE_39. Modo "chave": chave NF-e de 44 dígitos (barra ou QR).
 */
public class LeitorActivity extends AppCompatActivity {
    public static final String EXTRA_MODO = "modo";
    public static final String EXTRA_RAW = "codigo_raw";
    public static final String MODO_PRODUTO = "produto";
    public static final String MODO_CHAVE = "chave";
    /** Resultado pedindo o leitor antigo (ZXing) no lugar deste. */
    public static final int RESULT_LEITOR_ALTERNATIVO = Activity.RESULT_FIRST_USER + 1;

    private static final int REQ_CAMERA = 41;
    private static final Pattern CHAVE_44 = Pattern.compile("(\\d{44})");
    private static final Pattern CHAVE_QUERY =
            Pattern.compile("(?:chNFe|chave|chAce|chaveAcesso)=(\\d{44})", Pattern.CASE_INSENSITIVE);
    private static final Pattern CHAVE_P = Pattern.compile("[?&]p=(\\d{44})(?:\\||&|$)", Pattern.CASE_INSENSITIVE);

    private PreviewView previewView;
    private MolduraView moldura;
    private ExecutorService cameraExecutor;
    private BarcodeScanner scanner;
    private Camera camera;
    private boolean modoChave;
    private final AtomicBoolean done = new AtomicBoolean(false);
    private final AtomicBoolean erroAvisado = new AtomicBoolean(false);
    /** CODE_128/CODE_39 de produto não têm dígito verificador forte: exige duas leituras iguais. */
    private String ultimaLeitura = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        modoChave = MODO_CHAVE.equals(getIntent().getStringExtra(EXTRA_MODO));
        setRequestedOrientation(modoChave
                ? ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
                : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        setContentView(R.layout.activity_leitor);
        previewView = findViewById(R.id.preview_view);
        moldura = findViewById(R.id.moldura);
        moldura.setProporcao(modoChave ? 0.26f : 0.5f);
        TextView titulo = findViewById(R.id.txt_titulo);
        TextView dica = findViewById(R.id.txt_dica);
        titulo.setText(modoChave ? "Chave de acesso da NF-e" : "Código de barras do produto");
        dica.setText(modoChave
                ? "Encaixe a faixa inteira da chave (ou o QR) dentro da caixa. Deitar o celular ajuda."
                : "Encaixe o código de barras dentro da caixa.");

        Button btnCancel = findViewById(R.id.btn_cancel);
        btnCancel.setOnClickListener(v -> {
            setResult(Activity.RESULT_CANCELED);
            finish();
        });
        Button btnAlternativo = findViewById(R.id.btn_alternativo);
        if (modoChave) {
            btnAlternativo.setVisibility(View.GONE);
        } else {
            btnAlternativo.setOnClickListener(v -> {
                setResult(RESULT_LEITOR_ALTERNATIVO);
                finish();
            });
        }

        cameraExecutor = Executors.newSingleThreadExecutor();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        } else {
            startCamera();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CAMERA
                && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            Toast.makeText(this, R.string.camera_denied, Toast.LENGTH_LONG).show();
            setResult(Activity.RESULT_CANCELED);
            finish();
        }
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());

                // Chave = CODE_128 de 44 dígitos (~290 módulos): precisa de mais pixels que um EAN-13.
                ImageAnalysis analysis = new ImageAnalysis.Builder()
                        .setTargetResolution(modoChave ? new Size(1920, 1080) : new Size(1280, 720))
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build();

                provider.unbindAll();
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis);
                scanner = BarcodeScanning.getClient(opcoesLeitor());
                analysis.setAnalyzer(cameraExecutor, imageProxy -> {
                    if (done.get()) {
                        imageProxy.close();
                        return;
                    }
                    analyzeFrame(imageProxy);
                });
                configurarToque();
                previewView.post(this::focarNaCaixa);
            } catch (Exception e) {
                Toast.makeText(this, "Falha ao abrir câmera: " + e.getMessage(), Toast.LENGTH_LONG).show();
                setResult(Activity.RESULT_CANCELED);
                finish();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private BarcodeScannerOptions opcoesLeitor() {
        BarcodeScannerOptions.Builder b = new BarcodeScannerOptions.Builder();
        if (modoChave) {
            b.setBarcodeFormats(Barcode.FORMAT_CODE_128, Barcode.FORMAT_ITF,
                    Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_39);
        } else {
            b.setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A,
                    Barcode.FORMAT_UPC_E, Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39);
        }
        ZoomState zoom = camera != null ? camera.getCameraInfo().getZoomState().getValue() : null;
        if (zoom != null && zoom.getMaxZoomRatio() > 1.2f) {
            // Código pequeno/longe: o ML Kit sugere o zoom e a câmera aproxima sozinha.
            b.setZoomSuggestionOptions(new ZoomSuggestionOptions.Builder(ratio -> {
                if (camera == null) return false;
                camera.getCameraControl().setZoomRatio(ratio);
                return true;
            }).setMaxSupportedZoomRatio(Math.min(zoom.getMaxZoomRatio(), 5f)).build());
        }
        return b.build();
    }

    @SuppressLint("ClickableViewAccessibility")
    private void configurarToque() {
        ScaleGestureDetector pinca = new ScaleGestureDetector(this,
                new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                    @Override
                    public boolean onScale(@NonNull ScaleGestureDetector d) {
                        ZoomState z = camera.getCameraInfo().getZoomState().getValue();
                        if (z == null) return false;
                        float novo = Math.max(z.getMinZoomRatio(),
                                Math.min(z.getMaxZoomRatio(), z.getZoomRatio() * d.getScaleFactor()));
                        camera.getCameraControl().setZoomRatio(novo);
                        return true;
                    }
                });
        moldura.setOnTouchListener((v, ev) -> {
            pinca.onTouchEvent(ev);
            if (ev.getAction() == MotionEvent.ACTION_UP && !pinca.isInProgress()) {
                focarEm(ev.getX(), ev.getY());
                v.performClick();
            }
            return true;
        });
    }

    private void focarNaCaixa() {
        focarEm(moldura.getCaixa().centerX(), moldura.getCaixa().centerY());
    }

    private void focarEm(float x, float y) {
        if (camera == null || previewView.getWidth() == 0) return;
        MeteringPoint point = previewView.getMeteringPointFactory().createPoint(x, y);
        camera.getCameraControl().startFocusAndMetering(
                new FocusMeteringAction.Builder(point)
                        .setAutoCancelDuration(3, TimeUnit.SECONDS)
                        .build());
    }

    @OptIn(markerClass = ExperimentalGetImage.class)
    private void analyzeFrame(ImageProxy imageProxy) {
        try {
            if (imageProxy.getImage() == null || scanner == null) {
                imageProxy.close();
                return;
            }
            InputImage image = InputImage.fromMediaImage(
                    imageProxy.getImage(),
                    imageProxy.getImageInfo().getRotationDegrees()
            );
            scanner.process(image)
                    .addOnSuccessListener(barcodes -> {
                        if (done.get() || barcodes == null) return;
                        for (Barcode b : barcodes) {
                            String valor = modoChave ? extractChave(b.getRawValue()) : valorProduto(b);
                            if (valor != null) {
                                finishWithResult(valor);
                                return;
                            }
                        }
                    })
                    .addOnFailureListener(e -> {
                        if (erroAvisado.compareAndSet(false, true)) {
                            runOnUiThread(() -> Toast.makeText(this,
                                    "Leitor da câmera com erro: " + e.getMessage(), Toast.LENGTH_LONG).show());
                        }
                    })
                    .addOnCompleteListener(t -> imageProxy.close());
        } catch (Exception e) {
            imageProxy.close();
        }
    }

    private String valorProduto(Barcode b) {
        String raw = b.getRawValue();
        if (raw == null || raw.trim().isEmpty()) return null;
        raw = raw.trim();
        int f = b.getFormat();
        boolean comVerificador = f == Barcode.FORMAT_EAN_13 || f == Barcode.FORMAT_EAN_8
                || f == Barcode.FORMAT_UPC_A || f == Barcode.FORMAT_UPC_E;
        if (comVerificador) return raw;
        if (raw.equals(ultimaLeitura)) return raw;
        ultimaLeitura = raw;
        return null;
    }

    private static String extractChave(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        Matcher q = CHAVE_QUERY.matcher(raw);
        if (q.find()) return q.group(1);
        Matcher p = CHAVE_P.matcher(raw);
        if (p.find()) return p.group(1);
        String digits = raw.replaceAll("\\D", "");
        Matcher m = CHAVE_44.matcher(digits);
        if (m.find()) return m.group(1);
        return null;
    }

    private void finishWithResult(String valor) {
        if (!done.compareAndSet(false, true)) return;
        runOnUiThread(() -> moldura.marcarLido());
        try {
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 80);
            tone.startTone(ToneGenerator.TONE_PROP_ACK, 120);
            tone.release();
        } catch (Exception ignored) { /* sem som não impede a leitura */ }
        Intent data = new Intent();
        data.putExtra(EXTRA_RAW, valor);
        setResult(Activity.RESULT_OK, data);
        finish();
    }

    @Override
    protected void onDestroy() {
        done.set(true);
        if (cameraExecutor != null) cameraExecutor.shutdown();
        if (scanner != null) scanner.close();
        super.onDestroy();
    }
}
