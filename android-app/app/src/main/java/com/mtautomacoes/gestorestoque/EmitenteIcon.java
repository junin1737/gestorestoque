package com.mtautomacoes.gestorestoque;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.widget.ImageView;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class EmitenteIcon {
    private static final String PREFS = "gestor_prefs";
    private static final String KEY_NOME = "emitente_nome";
    private static final String FILE_ICON = "emitente_icon.png";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static final Handler UI = new Handler(Looper.getMainLooper());

    private EmitenteIcon() {}

    static void restore(Activity activity, ImageView view, TextView title) {
        SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String nome = prefs.getString(KEY_NOME, "");
        Bitmap saved = loadSaved(activity);
        Bitmap icon = saved != null ? saved : initialsBitmap(initialsFromName(nome), 192);
        apply(activity, view, title, displayName(nome), icon);
    }

    static void fetchFromServer(Activity activity, ImageView view, TextView title, String serverUrl) {
        IO.execute(() -> {
            try {
                String base = serverUrl == null ? "" : serverUrl.trim();
                if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
                if (base.isEmpty()) return;
                URL url = new URL(base + "/api/emitente");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(12000);
                conn.setRequestProperty("Accept", "application/json");
                int code = conn.getResponseCode();
                InputStream in = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
                if (in == null) return;
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                in.close();
                conn.disconnect();
                JSONObject json = new JSONObject(new String(bos.toByteArray(), StandardCharsets.UTF_8));
                JSONObject emitente = json.optJSONObject("emitente");
                if (emitente == null) return;
                String nome = emitente.optString("nome_fanta", "");
                Bitmap logo = decodeDataUrl(emitente.optString("logo", ""));
                Bitmap icon = logo != null ? squareLogo(logo, 192) : initialsBitmap(initialsFromName(nome), 192);
                save(activity, nome, icon);
                UI.post(() -> apply(activity, view, title, displayName(nome), icon));
            } catch (Exception ignored) {
                /* sem serviço ou JSON inválido: mantém ícone atual */
            }
        });
    }

    static void applyFromJs(Activity activity, ImageView view, TextView title, String nome, String logoDataUrl) {
        IO.execute(() -> {
            Bitmap logo = decodeDataUrl(logoDataUrl);
            Bitmap icon = logo != null ? squareLogo(logo, 192) : initialsBitmap(initialsFromName(nome), 192);
            save(activity, nome, icon);
            UI.post(() -> apply(activity, view, title, displayName(nome), icon));
        });
    }

    private static void apply(Activity activity, ImageView view, TextView title, String label, Bitmap icon) {
        if (activity.isFinishing()) return;
        if (view != null && icon != null) view.setImageBitmap(icon);
        if (title != null) title.setText(label);
        try {
            activity.setTaskDescription(new ActivityManager.TaskDescription(label, icon));
        } catch (Exception ignored) {
            /* alguns launchers recusam bitmap nulo */
        }
    }

    private static void save(Context ctx, String nome, Bitmap icon) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_NOME, nome == null ? "" : nome)
                .apply();
        if (icon == null) return;
        File file = new File(ctx.getFilesDir(), FILE_ICON);
        try (FileOutputStream out = new FileOutputStream(file)) {
            icon.compress(Bitmap.CompressFormat.PNG, 100, out);
        } catch (Exception ignored) { /* ignore */ }
    }

    private static Bitmap loadSaved(Context ctx) {
        File file = new File(ctx.getFilesDir(), FILE_ICON);
        if (!file.exists()) return null;
        return BitmapFactory.decodeFile(file.getAbsolutePath());
    }

    private static String displayName(String nome) {
        String n = nome == null ? "" : nome.trim();
        return n.isEmpty() ? "Gestor Estoque" : n;
    }

    static String initialsFromName(String nome) {
        String raw = nome == null ? "" : nome.trim();
        String[] parts = raw.split("\\s+");
        StringBuilder letters = new StringBuilder();
        for (String part : parts) {
            if (part.isEmpty()) continue;
            if (part.matches("(?i)de|da|do|das|dos|e|the|and")) continue;
            letters.append(part.charAt(0));
            if (letters.length() >= 2) break;
        }
        if (letters.length() >= 2) return letters.toString().toUpperCase();
        String alnum = raw.replaceAll("[^A-Za-z0-9À-ÿ]", "");
        if (alnum.length() >= 2) return alnum.substring(0, 2).toUpperCase();
        if (alnum.length() == 1) return (alnum + alnum).toUpperCase();
        return "GE";
    }

    private static Bitmap decodeDataUrl(String dataUrl) {
        if (dataUrl == null) return null;
        int comma = dataUrl.indexOf(',');
        if (comma < 0 || !dataUrl.startsWith("data:")) return null;
        try {
            byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) {
            return null;
        }
    }

    private static Bitmap squareLogo(Bitmap src, int size) {
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        bg.setColor(averageColor(src));
        float r = size * 0.22f;
        canvas.drawRoundRect(new RectF(0, 0, size, size), r, r, bg);
        float pad = size * 0.14f;
        float box = size - 2 * pad;
        float scale = Math.min(box / src.getWidth(), box / src.getHeight());
        float w = src.getWidth() * scale;
        float h = src.getHeight() * scale;
        float x = (size - w) / 2f;
        float y = (size - h) / 2f;
        Paint imgPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        canvas.drawBitmap(src, null, new RectF(x, y, x + w, y + h), imgPaint);
        return out;
    }

    static Bitmap initialsBitmap(String initials, int size) {
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        bg.setColor(Color.parseColor("#1E3A5F"));
        float r = size * 0.22f;
        canvas.drawRoundRect(new RectF(0, 0, size, size), r, r, bg);
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setColor(Color.WHITE);
        text.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        text.setTextAlign(Paint.Align.CENTER);
        text.setTextSize(size * 0.38f);
        Paint.FontMetrics fm = text.getFontMetrics();
        float cy = size / 2f - (fm.ascent + fm.descent) / 2f;
        canvas.drawText(initials, size / 2f, cy, text);
        return out;
    }

    private static int averageColor(Bitmap src) {
        long r = 0, g = 0, b = 0, n = 0;
        int step = Math.max(1, Math.min(src.getWidth(), src.getHeight()) / 16);
        for (int y = 0; y < src.getHeight(); y += step) {
            for (int x = 0; x < src.getWidth(); x += step) {
                int c = src.getPixel(x, y);
                int a = Color.alpha(c);
                if (a < 80) continue;
                r += Color.red(c);
                g += Color.green(c);
                b += Color.blue(c);
                n++;
            }
        }
        if (n < 1) return Color.parseColor("#1E3A5F");
        return Color.rgb((int) (r / n), (int) (g / n), (int) (b / n));
    }
}
