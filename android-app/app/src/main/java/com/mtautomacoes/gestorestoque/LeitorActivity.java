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
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Leitor da chave NF-e com caixa de foco (CameraX + ML Kit).
 * Lê a barra/QR e, em quadros alternados, os 44 dígitos impressos (OCR). Só aceita chave válida
 * (UF, mês, modelo 55/65 e dígito verificador); pelo OCR exige duas leituras iguais.
 */
public class LeitorActivity extends AppCompatActivity {
    public static final String EXTRA_MODO = "modo";
    public static final String EXTRA_RAW = "codigo_raw";
    public static final String MODO_CHAVE = "chave";

    private static final int REQ_CAMERA = 41;
    private static final Pattern CHAVE_QUERY =
            Pattern.compile("(?:chNFe|chave|chAce|chaveAcesso)=(\\d{44})", Pattern.CASE_INSENSITIVE);
    private static final Pattern CHAVE_P = Pattern.compile("[?&]p=(\\d{44})(?:\\||&|$)", Pattern.CASE_INSENSITIVE);
    private static final int[] UFS = {11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29,
            31, 32, 33, 35, 41, 42, 43, 50, 51, 52, 53};

    private PreviewView previewView;
    private MolduraView moldura;
    private ExecutorService cameraExecutor;
    private BarcodeScanner scanner;
    private TextRecognizer ocr;
    private Camera camera;
    private int quadro = 0;
    private String ultimaOcr = null;
    private final AtomicBoolean done = new AtomicBoolean(false);
    private final AtomicBoolean erroAvisado = new AtomicBoolean(false);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
        setContentView(R.layout.activity_leitor);
        previewView = findViewById(R.id.preview_view);
        moldura = findViewById(R.id.moldura);
        moldura.setProporcao(0.3f);
        TextView titulo = findViewById(R.id.txt_titulo);
        TextView dica = findViewById(R.id.txt_dica);
        titulo.setText("Chave de acesso da NF-e");
        dica.setText("Encaixe na caixa a barra da chave ou os 44 números abaixo dela. Deitar o celular ajuda.");

        Button btnCancel = findViewById(R.id.btn_cancel);
        btnCancel.setOnClickListener(v -> {
            setResult(Activity.RESULT_CANCELED);
            finish();
        });

        BarcodeScannerOptions options = new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_CODE_128, Barcode.FORMAT_ITF,
                        Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_39)
                .build();
        scanner = BarcodeScanning.getClient(options);
        ocr = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
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

                // CODE_128 de 44 dígitos (~290 módulos) e números pequenos: precisa de 1080p.
                ImageAnalysis analysis = new ImageAnalysis.Builder()
                        .setTargetResolution(new Size(1920, 1080))
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build();
                analysis.setAnalyzer(cameraExecutor, imageProxy -> {
                    if (done.get()) {
                        imageProxy.close();
                        return;
                    }
                    analyzeFrame(imageProxy);
                });

                provider.unbindAll();
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis);
                configurarToque();
                previewView.post(this::focarNaCaixa);
            } catch (Exception e) {
                Toast.makeText(this, "Falha ao abrir câmera: " + e.getMessage(), Toast.LENGTH_LONG).show();
                setResult(Activity.RESULT_CANCELED);
                finish();
            }
        }, ContextCompat.getMainExecutor(this));
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
            if (imageProxy.getImage() == null) {
                imageProxy.close();
                return;
            }
            InputImage image = InputImage.fromMediaImage(
                    imageProxy.getImage(),
                    imageProxy.getImageInfo().getRotationDegrees()
            );
            boolean vezDoOcr = (quadro++ % 2) == 1;
            if (vezDoOcr) {
                ocr.process(image)
                        .addOnSuccessListener(this::avaliarTexto)
                        .addOnFailureListener(this::avisarErro)
                        .addOnCompleteListener(t -> imageProxy.close());
            } else {
                scanner.process(image)
                        .addOnSuccessListener(barcodes -> {
                            if (done.get() || barcodes == null) return;
                            for (Barcode b : barcodes) {
                                String chave = chaveDaBarra(b.getRawValue());
                                if (chave != null) {
                                    finishWithResult(chave);
                                    return;
                                }
                            }
                        })
                        .addOnFailureListener(this::avisarErro)
                        .addOnCompleteListener(t -> imageProxy.close());
            }
        } catch (Exception e) {
            imageProxy.close();
        }
    }

    private void avisarErro(Exception e) {
        if (erroAvisado.compareAndSet(false, true)) {
            runOnUiThread(() -> Toast.makeText(this,
                    "Leitor da câmera com erro: " + e.getMessage(), Toast.LENGTH_LONG).show());
        }
    }

    private void avaliarTexto(Text texto) {
        if (done.get() || texto == null) return;
        List<String> linhas = new ArrayList<>();
        for (Text.TextBlock bloco : texto.getTextBlocks()) {
            for (Text.Line linha : bloco.getLines()) linhas.add(digitosOcr(linha.getText()));
        }
        String chave = null;
        for (String d : linhas) {
            chave = chaveEmDigitos(d);
            if (chave != null) break;
        }
        for (int i = 0; chave == null && i + 1 < linhas.size(); i++) {
            chave = chaveEmDigitos(linhas.get(i) + linhas.get(i + 1));
        }
        if (chave == null) return;
        if (chave.equals(ultimaOcr)) {
            finishWithResult(chave);
        } else {
            ultimaOcr = chave;
        }
    }

    /** Troca letras que o OCR confunde com números (O→0, I→1, S→5, B→8…) e remove o resto. */
    private static String digitosOcr(String s) {
        StringBuilder sb = new StringBuilder();
        for (char ch : s.toCharArray()) {
            switch (ch) {
                case 'O': case 'o': case 'D': case 'Q': sb.append('0'); break;
                case 'I': case 'l': case 'i': case '|': sb.append('1'); break;
                case 'S': case 's': sb.append('5'); break;
                case 'B': sb.append('8'); break;
                case 'Z': case 'z': sb.append('2'); break;
                case 'G': case 'b': sb.append('6'); break;
                case 'g': case 'q': sb.append('9'); break;
                default: if (ch >= '0' && ch <= '9') sb.append(ch);
            }
        }
        return sb.toString();
    }

    private static String chaveDaBarra(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        Matcher q = CHAVE_QUERY.matcher(raw);
        if (q.find() && chaveValida(q.group(1))) return q.group(1);
        Matcher p = CHAVE_P.matcher(raw);
        if (p.find() && chaveValida(p.group(1))) return p.group(1);
        return chaveEmDigitos(raw.replaceAll("\\D", ""));
    }

    private static String chaveEmDigitos(String d) {
        for (int i = 0; i + 44 <= d.length(); i++) {
            String c = d.substring(i, i + 44);
            if (chaveValida(c)) return c;
        }
        return null;
    }

    static boolean chaveValida(String c) {
        if (c == null || c.length() != 44) return false;
        for (int i = 0; i < 44; i++) if (c.charAt(i) < '0' || c.charAt(i) > '9') return false;
        int uf = Integer.parseInt(c.substring(0, 2));
        boolean ufOk = false;
        for (int u : UFS) if (u == uf) { ufOk = true; break; }
        if (!ufOk) return false;
        int mes = Integer.parseInt(c.substring(4, 6));
        if (mes < 1 || mes > 12) return false;
        String modelo = c.substring(20, 22);
        if (!modelo.equals("55") && !modelo.equals("65")) return false;
        int soma = 0;
        int peso = 2;
        for (int i = 42; i >= 0; i--) {
            soma += (c.charAt(i) - '0') * peso;
            peso = peso == 9 ? 2 : peso + 1;
        }
        int r = soma % 11;
        int dv = r < 2 ? 0 : 11 - r;
        return dv == c.charAt(43) - '0';
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
        if (ocr != null) ocr.close();
        super.onDestroy();
    }
}
