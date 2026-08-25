package com.mtautomacoes.gestorestoque;

import com.journeyapps.barcodescanner.CaptureActivity;

/**
 * Scanner sem trava de orientação — necessário para a chave NF-e (CODE_128 longo).
 * O PortraitCaptureActivity permanece para EAN/produto.
 */
public class AnyOrientationCaptureActivity extends CaptureActivity {
}
