// csv-export.js — shared CSV download helper for the AniMart admin panel.
//
// Loaded globally from a <script> tag on pages with an "Export CSV" button.
// Usage:  downloadCSV('users', ['Name','Email'], [['Ana','a@x.com'], …]);
// Values are quoted/escaped per RFC 4180; a UTF-8 BOM is prepended so Excel
// opens the file with the right encoding (₱, accented names).

(function (global) {
    function downloadCSV(basename, header, rows) {
        const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const lines = [header.map(esc).join(',')];
        rows.forEach(r => lines.push(r.map(esc).join(',')));

        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `animart-${basename}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    global.downloadCSV = downloadCSV;
})(window);
