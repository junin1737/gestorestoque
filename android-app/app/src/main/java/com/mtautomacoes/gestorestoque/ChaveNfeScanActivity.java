package com.mtautomacoes.gestorestoque;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Bundle;
import android.util.Size;
import android.widget.Button;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.camera.core.ExperimentalGetImage;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.Preview;
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

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Scanner contínuo e rápido da chave NF-e (ML Kit + CameraX).
 * Substitui o Google Code Scanner (auto-zoom lento).
 */
public class ChaveNfeScanActivity extends AppCompatActivity {
    public static final String EXTRA_RAW = "chave_raw";
    private static final int REQ_CAMERA = 41;
    private static final Pattern CHAVE_44 = Pattern.compile("(\\d{44})");

    private PreviewView previewView;
    private ExecutorService cameraExecutor;
    private BarcodeScanner scanner;
    private final AtomicBoolean done = new AtomicBoolean(false);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_chave_nfe_scan);
        previewView = findViewById(R.id.preview_view);
        Button btnCancel = findViewById(R.id.btn_cancel);
        btnCancel.setOnClickListener(v -> {
            setResult(Activity.RESULT_CANCELED);
            finish();
        });

        cameraExecutor = Executors.newSingleThreadExecutor();
        BarcodeScannerOptions options = new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(
                        Barcode.FORMAT_CODE_128,
                        Barcode.FORMAT_ITF,
                        Barcode.FORMAT_QR_CODE,
                        Barcode.FORMAT_CODE_39
                )
                .build();
        scanner = BarcodeScanning.getClient(options);

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

                ImageAnalysis analysis = new ImageAnalysis.Builder()
                        .setTargetResolution(new Size(1280, 720))
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
                provider.bindToLifecycle(
                        this,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis
                );
            } catch (Exception e) {
                Toast.makeText(this, "Falha ao abrir câmera: " + e.getMessage(), Toast.LENGTH_LONG).show();
                setResult(Activity.RESULT_CANCELED);
                finish();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    @OptIn(markerClass = ExperimentalGetImage.class)
    private void analyzeFrame(androidx.camera.core.ImageProxy imageProxy) {
        try {
            if (imageProxy.getImage() == null) {
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
                            String chave = extractChave(b.getRawValue());
                            if (chave != null) {
                                finishWithResult(chave);
                                return;
                            }
                        }
                    })
                    .addOnCompleteListener(t -> imageProxy.close());
        } catch (Exception e) {
            imageProxy.close();
        }
    }

    private static String extractChave(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        Matcher q = Pattern.compile("(?:chNFe|chave|chAce|chaveAcesso)=(\\d{44})", Pattern.CASE_INSENSITIVE)
                .matcher(raw);
        if (q.find()) return q.group(1);
        Matcher p = Pattern.compile("[?&]p=(\\d{44})(?:\\||&|$)", Pattern.CASE_INSENSITIVE).matcher(raw);
        if (p.find()) return p.group(1);
        String digits = raw.replaceAll("\\D", "");
        Matcher m = CHAVE_44.matcher(digits);
        if (m.find()) return m.group(1);
        if (digits.length() >= 44) return digits.substring(0, 44);
        return null;
    }

    private void finishWithResult(String chave) {
        if (!done.compareAndSet(false, true)) return;
        try {
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 80);
            tone.startTone(ToneGenerator.TONE_PROP_ACK, 120);
            tone.release();
        } catch (Exception ignored) { /* ignore */ }
        Intent data = new Intent();
        data.putExtra(EXTRA_RAW, chave);
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
