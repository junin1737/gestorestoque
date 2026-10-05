package com.mtautomacoes.gestorestoque;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.View;

/** Escurece a tela fora da caixa onde o código de barras deve ser encaixado. */
public class MolduraView extends View {
    private final Paint fundo = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint borda = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint cantos = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint linha = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path recorte = new Path();
    private final RectF caixa = new RectF();
    /** Altura da caixa em relação à largura (produto ~0,5; chave NF-e bem mais baixa e larga). */
    private float proporcao = 0.5f;
    private boolean lido = false;

    public MolduraView(Context context) {
        this(context, null);
    }

    public MolduraView(Context context, AttributeSet attrs) {
        super(context, attrs);
        fundo.setColor(Color.argb(150, 0, 0, 0));
        fundo.setStyle(Paint.Style.FILL);
        borda.setColor(Color.argb(140, 255, 255, 255));
        borda.setStyle(Paint.Style.STROKE);
        borda.setStrokeWidth(dp(1.5f));
        cantos.setColor(Color.WHITE);
        cantos.setStyle(Paint.Style.STROKE);
        cantos.setStrokeWidth(dp(4));
        cantos.setStrokeCap(Paint.Cap.ROUND);
        linha.setColor(Color.argb(200, 255, 82, 82));
        linha.setStrokeWidth(dp(2));
    }

    void setProporcao(float p) {
        proporcao = p;
        requestLayout();
        invalidate();
    }

    void marcarLido() {
        lido = true;
        cantos.setColor(Color.rgb(76, 217, 100));
        invalidate();
    }

    RectF getCaixa() {
        return caixa;
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        boolean deitado = w > h;
        float largura = w * (deitado ? 0.72f : 0.88f);
        float altura = largura * proporcao;
        float maxAltura = h * 0.6f;
        if (altura > maxAltura) {
            altura = maxAltura;
            largura = altura / proporcao;
        }
        float left = (w - largura) / 2f;
        float top = (h - altura) / 2f;
        caixa.set(left, top, left + largura, top + altura);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float r = dp(16);
        recorte.reset();
        recorte.setFillType(Path.FillType.EVEN_ODD);
        recorte.addRect(0, 0, getWidth(), getHeight(), Path.Direction.CW);
        recorte.addRoundRect(caixa, r, r, Path.Direction.CW);
        canvas.drawPath(recorte, fundo);
        canvas.drawRoundRect(caixa, r, r, borda);

        float c = Math.min(dp(28), caixa.height() / 2.5f);
        float l = caixa.left, t = caixa.top, rr = caixa.right, b = caixa.bottom;
        canvas.drawLine(l, t + c, l, t + r / 2, cantos);
        canvas.drawLine(l + r / 2, t, l + c, t, cantos);
        canvas.drawLine(rr - c, t, rr - r / 2, t, cantos);
        canvas.drawLine(rr, t + r / 2, rr, t + c, cantos);
        canvas.drawLine(l, b - c, l, b - r / 2, cantos);
        canvas.drawLine(l + r / 2, b, l + c, b, cantos);
        canvas.drawLine(rr - c, b, rr - r / 2, b, cantos);
        canvas.drawLine(rr, b - r / 2, rr, b - c, cantos);
        if (!lido) {
            float y = caixa.centerY();
            canvas.drawLine(l + dp(12), y, rr - dp(12), y, linha);
        }
    }

    private float dp(float v) {
        return v * getResources().getDisplayMetrics().density;
    }
}
