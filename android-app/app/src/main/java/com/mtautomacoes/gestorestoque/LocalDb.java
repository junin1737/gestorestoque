package com.mtautomacoes.gestorestoque;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/**
 * Base SQLite local do aparelho (gestor_local.db). Ainda sem uso funcional: novas tabelas
 * entram em onUpgrade subindo VERSAO, sem apagar dados já gravados no celular.
 */
final class LocalDb extends SQLiteOpenHelper {
    private static final String NOME = "gestor_local.db";
    private static final int VERSAO = 1;

    private static LocalDb instancia;

    static synchronized LocalDb get(Context ctx) {
        if (instancia == null) instancia = new LocalDb(ctx.getApplicationContext());
        return instancia;
    }

    private LocalDb(Context ctx) {
        super(ctx, NOME, null, VERSAO);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE app_info (chave TEXT PRIMARY KEY, valor TEXT)");
        ContentValues v = new ContentValues();
        v.put("chave", "criado_em");
        v.put("valor", String.valueOf(System.currentTimeMillis()));
        db.insert("app_info", null, v);
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int versaoAntiga, int versaoNova) {
        /* migrações futuras: if (versaoAntiga < 2) { ... } */
    }

    String getInfo(String chave) {
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT valor FROM app_info WHERE chave = ?", new String[]{chave})) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }

    void setInfo(String chave, String valor) {
        ContentValues v = new ContentValues();
        v.put("chave", chave);
        v.put("valor", valor);
        getWritableDatabase().insertWithOnConflict("app_info", null, v, SQLiteDatabase.CONFLICT_REPLACE);
    }
}
