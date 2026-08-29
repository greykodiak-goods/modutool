package com.thisismy.pdf;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Parcelable;
import android.provider.OpenableColumns;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 다른 앱에서 넘어온 PDF(ACTION_VIEW / ACTION_SEND / ACTION_SEND_MULTIPLE)를
 * 웹 레이어가 읽는 대기열에 넣는다.
 *
 * <p>대기열 = 캐시 디렉터리의 {@code mdtl-intake/} + 파일 목록 {@code intake.json}.
 * 이 경로는 Capacitor Filesystem 플러그인의 {@code Directory.CACHE} 와 같은 곳이라
 * assets/site.js 의 {@code mdtlCheckIntake()} 가 플러그인 추가 없이 그대로 읽는다.
 *
 * <p>네이티브가 JS를 호출(evaluateJavascript)하지 않고 파일로 남기는 이유: 콜드스타트에서는
 * 인텐트가 웹뷰 스크립트보다 먼저 도착해 이벤트가 그냥 사라진다. 파일로 두면 페이지가 뜬 뒤
 * 스스로 확인한다.
 */
public class MainActivity extends BridgeActivity {

    private static final String INTAKE_DIR = "mdtl-intake";
    private static final String INTAKE_LIST = "intake.json";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        stageIntake(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // 앱이 이미 떠 있는 경우: 인텐트가 먼저 도착하고 웹뷰는 곧이어 다시 보이게 된다
        // → site.js 의 visibilitychange 훅이 대기열을 집어간다.
        stageIntake(intent);
    }

    /** 인텐트에서 PDF를 뽑아 캐시 대기열에 복사한다. 넘어온 파일이 없으면 아무 것도 하지 않는다. */
    private void stageIntake(Intent intent) {
        List<Uri> uris = incomingUris(intent);
        if (uris.isEmpty()) return;

        File dir = new File(getCacheDir(), INTAKE_DIR);
        clearDir(dir);
        if (!dir.isDirectory() && !dir.mkdirs()) return;

        JSONArray names = new JSONArray();
        for (int i = 0; i < uris.size(); i++) {
            String name = safeName(displayName(uris.get(i)), i);
            if (copyTo(uris.get(i), new File(dir, name))) names.put(name);
        }
        if (names.length() == 0) {
            clearDir(dir);
            return;
        }
        try {
            JSONObject list = new JSONObject();
            list.put("files", names);
            writeText(new File(dir, INTAKE_LIST), list.toString());
        } catch (Exception e) {
            clearDir(dir);   // 목록을 못 쓰면 웹이 찾을 수 없다 — 찌꺼기를 남기지 않는다
        }
    }

    private List<Uri> incomingUris(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        if (intent == null) return uris;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_EDIT.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Parcelable one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one instanceof Uri) uris.add((Uri) one);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Parcelable> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) {
                for (Parcelable p : many) if (p instanceof Uri) uris.add((Uri) p);
            }
        }
        return uris;
    }

    /** content:// 는 경로에 파일명이 없을 수 있다 — DISPLAY_NAME 을 먼저 본다. */
    private String displayName(Uri uri) {
        String name = null;
        Cursor c = null;
        try {
            c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) {
                int col = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (col >= 0) name = c.getString(col);
            }
        } catch (Exception e) {
            // 이름 조회 실패는 파일명만 잃는다 — 아래 기본값으로 계속
        } finally {
            closeQuietly(c);
        }
        return name != null ? name : uri.getLastPathSegment();
    }

    /** 파일명에서 경로 구분자를 걷어내고 .pdf 를 보장한다. 여러 개면 앞에 순번을 붙여 충돌을 막는다. */
    private String safeName(String raw, int index) {
        String n = raw == null ? "" : raw.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_").trim();
        if (n.isEmpty()) n = "shared.pdf";
        if (!n.toLowerCase(Locale.US).endsWith(".pdf")) n = n + ".pdf";
        return index == 0 ? n : (index + 1) + "-" + n;
    }

    private boolean copyTo(Uri uri, File dest) {
        InputStream in = null;
        OutputStream out = null;
        try {
            in = getContentResolver().openInputStream(uri);
            if (in == null) return false;
            out = new FileOutputStream(dest);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            closeQuietly(in);
            closeQuietly(out);
        }
    }

    private void writeText(File file, String text) throws Exception {
        OutputStream out = null;
        try {
            out = new FileOutputStream(file);
            out.write(text.getBytes("UTF-8"));
            out.flush();
        } finally {
            closeQuietly(out);
        }
    }

    /** 이전에 넘어왔다가 소비되지 않은 파일이 다음 실행에 되살아나지 않게 통째로 비운다. */
    private void clearDir(File dir) {
        File[] kids = dir.listFiles();
        if (kids != null) for (File f : kids) f.delete();
        dir.delete();
    }

    private void closeQuietly(Closeable c) {
        if (c == null) return;
        try {
            c.close();
        } catch (Exception e) {
            // 닫기 실패는 복구할 것이 없다
        }
    }
}
