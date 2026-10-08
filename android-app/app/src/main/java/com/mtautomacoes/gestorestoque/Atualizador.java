package com.mtautomacoes.gestorestoque;

import android.app.ProgressDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Compara a versão instalada com o package.json da branch online e,
 * se a release dessa versão tiver APK mais novo, baixa e instala.
 */
public final class Atualizador {
    private static final String PKG_URL =
            "https://raw.githubusercontent.com/junin1737/gestorestoque/online/package.json";
    private static final String RELEASE_URL =
            "https://api.github.com/repos/junin1737/gestorestoque/releases/tags/v";

    private static boolean consultou;
    private static File pendente;

    private Atualizador() {}

    public static void verificar(AppCompatActivity activity) {
        if (consultou || activity.isFinishing()) return;
        consultou = true;
        new Thread(() -> {
            try {
                String local = versaoInstalada(activity);
                String git = versaoDoGit();
                if (git.isEmpty() || cmp(git, local) <= 0) return;
                String download = apkDaRelease(git);
                if (download == null || activity.isFinishing()) return;
                activity.runOnUiThread(() -> perguntar(activity, local, git, download));
            } catch (Exception ignored) {
                /* sem rede: o painel segue sem atualizar */
            }
        }, "apk-versao").start();
    }

    public static void retomar(AppCompatActivity activity) {
        File apk = pendente;
        if (apk == null || !apk.isFile() || activity.isFinishing()) return;
        if (podeInstalar(activity)) instalar(activity, apk);
    }

    private static void perguntar(AppCompatActivity activity, String local, String git, String download) {
        if (activity.isFinishing()) return;
        new AlertDialog.Builder(activity)
                .setTitle(R.string.apk_atualizar_titulo)
                .setMessage(activity.getString(R.string.apk_atualizar_msg, git, local))
                .setPositiveButton(R.string.apk_atualizar_sim, (d, w) -> baixar(activity, download, git))
                .setNegativeButton(R.string.apk_atualizar_nao, null)
                .show();
    }

    private static void baixar(AppCompatActivity activity, String download, String git) {
        ProgressDialog dlg = new ProgressDialog(activity);
        dlg.setMessage(activity.getString(R.string.apk_baixando));
        dlg.setCancelable(false);
        dlg.show();
        new Thread(() -> {
            try {
                File dir = activity.getExternalFilesDir(null);
                if (dir == null) dir = activity.getCacheDir();
                File dest = new File(dir, "gestorestoque-online-" + git + ".apk");
                baixarArquivo(download, dest);
                pendente = dest;
                activity.runOnUiThread(() -> {
                    if (dlg.isShowing()) dlg.dismiss();
                    if (activity.isFinishing()) return;
                    if (!podeInstalar(activity)) {
                        Toast.makeText(activity, R.string.apk_permitir, Toast.LENGTH_LONG).show();
                        Intent perm = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + activity.getPackageName()));
                        activity.startActivity(perm);
                        return;
                    }
                    instalar(activity, dest);
                });
            } catch (Exception e) {
                activity.runOnUiThread(() -> {
                    if (dlg.isShowing()) dlg.dismiss();
                    Toast.makeText(activity, R.string.apk_falha, Toast.LENGTH_LONG).show();
                });
            }
        }, "apk-download").start();
    }

    private static boolean podeInstalar(AppCompatActivity activity) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || activity.getPackageManager().canRequestPackageInstalls();
    }

    private static void instalar(AppCompatActivity activity, File apk) {
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
        Intent inst = new Intent(Intent.ACTION_VIEW);
        inst.setDataAndType(uri, "application/vnd.android.package-archive");
        inst.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(inst);
    }

    private static String versaoInstalada(AppCompatActivity activity) {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (Exception e) {
            return "";
        }
    }

    private static String versaoDoGit() throws Exception {
        JSONObject pkg = new JSONObject(httpTexto(PKG_URL));
        return pkg.optString("version", "").trim();
    }

    private static String apkDaRelease(String versao) throws Exception {
        JSONObject release = new JSONObject(httpTexto(RELEASE_URL + versao));
        JSONArray assets = release.optJSONArray("assets");
        if (assets == null) return null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            String nome = asset.optString("name", "");
            if (nome.toLowerCase().endsWith(".apk") && nome.toLowerCase().startsWith("gestorestoque-online-")) {
                return asset.optString("browser_download_url", null);
            }
        }
        return null;
    }

    /** Mesma comparação do atualizador do Windows: "112-online" vale 112. */
    static int cmp(String a, String b) {
        String[] pa = a.replaceFirst("(?i)^v", "").split("\\.");
        String[] pb = b.replaceFirst("(?i)^v", "").split("\\.");
        int n = Math.max(pa.length, pb.length);
        for (int i = 0; i < n; i++) {
            int da = i < pa.length ? inteiro(pa[i]) : 0;
            int db = i < pb.length ? inteiro(pb[i]) : 0;
            if (da != db) return Integer.compare(da, db);
        }
        return 0;
    }

    private static int inteiro(String s) {
        int v = 0;
        int i = 0;
        while (i < s.length() && Character.isDigit(s.charAt(i))) {
            v = v * 10 + (s.charAt(i) - '0');
            i++;
        }
        return v;
    }

    private static String httpTexto(String endereco) throws Exception {
        HttpURLConnection conn = abrir(endereco);
        try (InputStream in = conn.getInputStream()) {
            byte[] buf = new byte[4096];
            StringBuilder texto = new StringBuilder();
            int n;
            while ((n = in.read(buf)) >= 0) texto.append(new String(buf, 0, n, StandardCharsets.UTF_8));
            return texto.toString();
        } finally {
            conn.disconnect();
        }
    }

    private static void baixarArquivo(String endereco, File dest) throws Exception {
        HttpURLConnection conn = abrir(endereco);
        try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
        } finally {
            conn.disconnect();
        }
        if (!dest.isFile() || dest.length() == 0) {
            throw new IllegalStateException("APK vazio");
        }
    }

    private static HttpURLConnection abrir(String endereco) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(endereco).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(120000);
        conn.setRequestProperty("User-Agent", "GestorEstoque-APK");
        conn.setRequestProperty("Accept", "application/vnd.github+json");
        conn.connect();
        int status = conn.getResponseCode();
        if (status >= 400) throw new IllegalStateException("HTTP " + status);
        return conn;
    }
}
