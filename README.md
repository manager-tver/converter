# ConvertLab — Конвертер документов онлайн

Бесплатный конвертер документов прямо в браузере. PDF ↔ JPG, Word ↔ PDF, Excel ↔ PDF и ещё 20+ форматов.

**Сайт:** https://manager-tver.github.io/converter/ (GitHub Pages)

## Возможности

- **PDF → JPG / PNG / TXT / DOCX / HTML** (все страницы, ZIP при нескольких)
- **DOCX → PDF / TXT / HTML / JPG / PNG**
- **JPG / PNG / WEBP → PDF / JPG / PNG / WEBP**
- **XLSX / XLS / CSV → PDF / CSV / JSON / XLSX / HTML / TXT / JPG**
- **TXT / MD / RTF → PDF / DOCX / HTML / TXT / JPG**
- **HTML → PDF / TXT / DOCX / JPG**
- **PPTX → TXT / PDF / DOCX / JPG**
- **JSON → PDF / TXT**

Всё обрабатывается **локально в браузере** (PDF.js, Mammoth, SheetJS, jsPDF, html2canvas, docx, JSZip) — файлы не отправляются на сервер. Приватно, бесплатно, без водяных знаков.

## Запуск локально

```bash
python3 -m http.server 8000 --bind 0.0.0.0
# открыть http://localhost:8000
```

## Деплой на GitHub Pages

Репозиторий уже готов для GitHub Pages: `index.html`, `style.css`, `app.js` в корне.
В настройках репозитория: Settings → Pages → Source: `main` / root.

## Структура

- `index.html` — разметка, UI конвертера, матрица форматов, FAQ
- `style.css` — стили (адаптив, тёмно-светлая тема карточек)
- `app.js` — вся логика конвертации на чистом JS + CDN-библиотеки
