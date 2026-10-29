/* 디자인 시스템 전·후 숫자. 인자 없이 돌리면 `이름 : 값` 다섯 줄만 찍는다.
   정의를 바꾸면 이전·이후 비교가 깨지므로 고치지 않는다. */
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
var read = function (f) { return fs.readFileSync(path.join(root, f), 'utf8'); };
var cssFiles = fs.readdirSync(root).filter(function (f) { return /\.css$/.test(f); });

/* 1. 함수 몸통: `  function name(` 시작 줄부터, 그 다음에 나오는 `  function ` 또는 `  var `
   (공백 정확히 둘로 시작) 줄 직전까지의 줄 수. 시작 줄 포함. 다음 줄이 없으면 파일 끝까지. */
var lines = read('js/ui/teacher.js').split('\n');
var NAMES = ['openDetail', 'compassCard', 'compassGist', 'levelRecords', 'codeBlock', 'row', 'mark', 'was'];
var jsLines = 0;
NAMES.forEach(function (n) {
  var s = lines.findIndex(function (l) { return l.indexOf('  function ' + n + '(') === 0; });
  if (s < 0) return;
  var e = s + 1;
  while (e < lines.length && !/^  (function |var )/.test(lines[e])) e++;
  jsLines += e - s;
});

/* 2. teacher.css 에서 줄 머리(앞 공백 허용)가 .detail · .d- · .compass- · .lv- · .mf · .saybox 인 줄 */
var cssRules = read('teacher.css').split('\n').filter(function (l) {
  return /^\s*\.(detail|d-|compass-|lv-|mf|saybox)/.test(l);
}).length;

/* 3. js/ui/*.js 의 `var el = function` + `function esc` 정의 줄 수 */
var helpers = 0;
fs.readdirSync(path.join(root, 'js/ui')).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
  read('js/ui/' + f).split('\n').forEach(function (l) {
    if (/\bvar el = function\b/.test(l) || /\bfunction esc\b/.test(l)) helpers++;
  });
});

/* 4·5. 루트의 *.css 중 줄 머리(앞 공백 허용)에서 `.이름` 을 정의하는 파일 수 (.chip-x 같은 접미는 제외) */
var defines = function (cls) {
  var re = new RegExp('^\\s*\\.' + cls + '(?![\\w-])', 'm');
  return cssFiles.filter(function (f) { return re.test(read(f)); }).length;
};
var dup = ['chip', 'tag', 'mark', 'code', 'btn'].reduce(function (a, c) { return a + defines(c); }, 0);

console.log('detail-js-lines : ' + jsLines);
console.log('detail-css-rules : ' + cssRules);
console.log('helper-defs : ' + helpers);
console.log('dup-class-defs : ' + dup);
console.log('files-to-restyle-chip : ' + defines('chip'));
