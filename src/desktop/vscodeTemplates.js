/** Starter projects for the VS Code app. Every toolchain below is already installed in the sandbox image, so `Run` works at once.
 *  `files` = { path: text }. Entries marked `scaffold` only hold a README with the one command that creates the real project (the
 *  generators need the network and are big), run it in the VS Code terminal (Ctrl+`). */
const readme = (title, body) => `# ${title}\n\n${body}\n`;

export const VSCODE_TEMPLATES = [
  { id: 'empty', en: 'Empty folder', ar: 'مجلد فاضي', color: '#64748b', tag: 'Any', files: { 'README.md': readme('New project', 'Start typing. Open the terminal with Ctrl+` and run anything.') } },
  { id: 'node', en: 'Node.js', ar: 'Node.js', color: '#3c873a', tag: 'JS', files: {
    'package.json': JSON.stringify({ name: 'my-app', version: '1.0.0', type: 'module', scripts: { start: 'node index.js', dev: 'node --watch index.js' } }, null, 2) + '\n',
    'index.js': "import http from 'node:http';\n\nhttp.createServer((req, res) => {\n  res.setHeader('content-type', 'text/html; charset=utf-8');\n  res.end('<h1>Hello from Node.js 👋</h1>');\n}).listen(3000, '0.0.0.0', () => console.log('http://localhost:3000'));\n",
    'README.md': readme('Node.js', 'Run `npm start` in the terminal. The server on port 3000 shows up in the Ports menu.') } },
  { id: 'react', en: 'React + Vite', ar: 'React + Vite', color: '#0ea5e9', tag: 'JS', scaffold: true, files: { 'README.md': readme('React + Vite', 'In the terminal:\n\n```bash\nnpm create vite@latest . -- --template react\nnpm install\nnpm run dev -- --host 0.0.0.0\n```\n\nThen open port 5173 from the Ports menu.') } },
  { id: 'python', en: 'Python', ar: 'Python', color: '#3776ab', tag: 'PY', files: {
    'main.py': 'name = input("What is your name? ")\nprint(f"Hello, {name}!")\n',
    'requirements.txt': '# one package per line, then: uv pip install -r requirements.txt\n',
    'README.md': readme('Python', 'Run `python3 main.py`. For a web app use Flask / FastAPI and bind `0.0.0.0`.') } },
  { id: 'laravel', en: 'Laravel / PHP', ar: 'Laravel / PHP', color: '#ef4444', tag: 'PHP', scaffold: true, files: { 'README.md': readme('Laravel', 'In the terminal:\n\n```bash\ncomposer create-project laravel/laravel .\nphp artisan serve --host=0.0.0.0 --port=8000\n```\n\nPort 8000 appears in the Ports menu. MariaDB and PostgreSQL are installed (start them from the terminal).') } },
  { id: 'static', en: 'HTML / CSS / JS', ar: 'HTML / CSS / JS', color: '#f97316', tag: 'WEB', files: {
    'index.html': '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>My page</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Hello 👋</h1>\n  <script src="app.js"></script>\n</body>\n</html>\n',
    'style.css': 'body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; }\n',
    'app.js': "console.log('ready');\n",
    'README.md': readme('Static site', 'Run `python3 -m http.server 8080 --bind 0.0.0.0` and open port 8080 from the Ports menu.') } },
  { id: 'cpp', en: 'C / C++', ar: 'C / C++', color: '#00599c', tag: 'C++', files: {
    'main.cpp': '#include <iostream>\n\nint main() {\n  std::cout << "Hello, C++!\\n";\n  return 0;\n}\n',
    'README.md': readme('C++', 'Build and run: `g++ -O1 -g main.cpp -o app && ./app`. gdb and cmake are installed.') } },
  { id: 'java', en: 'Java', ar: 'Java', color: '#e76f00', tag: 'JAVA', files: {
    'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello, Java!");\n  }\n}\n',
    'README.md': readme('Java 17', 'Run `javac Main.java && java Main`. Maven and Gradle are installed too.') } },
  { id: 'go', en: 'Go', ar: 'Go', color: '#00add8', tag: 'GO', files: {
    'go.mod': 'module example.com/app\n\ngo 1.23\n',
    'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, Go!")\n}\n',
    'README.md': readme('Go', 'Run `go run .`.') } },
  { id: 'rust', en: 'Rust', ar: 'Rust', color: '#b7410e', tag: 'RS', files: {
    'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n',
    'src/main.rs': 'fn main() {\n    println!("Hello, Rust!");\n}\n',
    'README.md': readme('Rust', 'Run `cargo run`.') } },
  { id: 'dotnet', en: '.NET (C#)', ar: '.NET (C#)', color: '#512bd4', tag: 'C#', scaffold: true, files: { 'README.md': readme('.NET 8', 'In the terminal:\n\n```bash\ndotnet new console\ndotnet run\n```') } },
];

/** what the sandbox image has installed — shown on the launcher */
export const VSCODE_ENVS = 'Node 22 · PHP 8.4 + Composer · Python 3 + uv · Java 17 + Maven + Gradle · Kotlin · C/C++ · Go · Rust · .NET 8 · Ruby · Dart · Julia · R · MariaDB · PostgreSQL · SQLite';
