package com.mtautomacoes.gestorestoque;

import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Handler;
import android.os.Looper;

/**
 * Beep de leitura no volume de mídia: toca mesmo com o celular no silencioso/vibrar
 * (o beep do ZXing respeita o modo de toque e fica mudo).
 */
final class Bip {
    private Bip() {}

    static void tocar() {
        try {
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 100);
            tone.startTone(ToneGenerator.TONE_PROP_BEEP, 150);
            // O tom é assíncrono: liberar na hora corta o som.
            new Handler(Looper.getMainLooper()).postDelayed(tone::release, 400);
        } catch (Exception ignored) { /* sem som não impede a leitura */ }
    }
}
