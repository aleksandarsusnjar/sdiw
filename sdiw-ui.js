const leftEditorElement = document.getElementById('editor-left')
const rightEditorElement = document.getElementById('editor-right')
const stdin = document.getElementById('stdin');
const stdout = document.getElementById('stdout');

var running = false;
var runEnd = null;
var leftEditor, rightEditor;
var lineMap = {};
var lines = [];
var completeAssembly = [];
var leftDecorations = [], rightDecorations = [];
var updateGutterLine = updateLeftEditorLine;
var memoryOperands = [];

function updateAssembly(event) {
    // See https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IModelContentChangedEvent.html
    // for the event parameter content.

    reassembleEverything(); // TO DO Improve, not critical now.
}

function reassembleEverything() {
    const model = rightEditor.getModel();
    const lineCount = model.getLineCount();
    lines = [];
    lineMap = {};

    restartAssembly();
    completeAssembly = [];
    let address = 0;

    leftEditor.setValue('\n'.repeat(lineCount));

    let errorLines = [];

    for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
        const content = model.getLineContent(lineNumber);

        const lineAssembly = assembleLine(lineNumber, address, content);
        completeAssembly.push(lineAssembly);
        address = lineAssembly.nextAddress;
        lines.push(lineAssembly.gutter);

        if (lineAssembly.label || lineAssembly.length > 0) {
            lineMap['' + lineAssembly.address] = lineNumber;
        }

        if (lineAssembly.error) {
            errorLines.push(lineNumber);   
        } else {
            removeDecorations("error", lineNumber);
        }
    }

    try {
        updateGutterLine = function (lineNumber, gutter) {
            lines[lineNumber - 1] = gutter;
        }
        for (assembledLine in completeAssembly) {
            const lineAssembly = completeAssembly[assembledLine];
            if (lineAssembly.instruction) {
                try {
                    lineAssembly.instruction.link();
                } catch (e) {
                    const gutter = lineAssembly.address.toString(16).padStart(8, '.') + ": " + e.message;
                    updateGutterLine(lineAssembly.lineNumber, gutter);
                    if (!lineAssembly.error) {
                        errorLines.push(lineNumber);   
                    }
                }
            }
        }
    } finally {
        updateGutterLine = updateLeftEditorLine;
    }

    leftEditor.setValue(lines.join('\n'));

    for (let lineNumber of errorLines) {
        addDecoration("error", lineNumber);
    }

    stdout.value = STDOUT;
    initializeRegisters();
    displayStatus();
}

function updateAddressGutter(address, newText) {
    const lineNumber = lineMap['' + address];

    if (!lineNumber) return;

    const gutter = address.toString(16).padStart(8, '.') + ": " + newText;
    updateGutterLine(lineNumber, gutter);
}

function updateLeftEditorLine(lineNumber, gutter) {
    const model = leftEditor.getModel();

    const lineLength = model.getLineLength(lineNumber);

    const range = new monaco.Range(
        lineNumber,
        1,
        lineNumber,
        lineLength + 1
    );

    try {
        leftEditor.updateOptions({ readOnly: false });

        model.pushEditOperations([], [
            {
                range,
                text: gutter
            }
        ], () => null);
    } finally {
        leftEditor.updateOptions({ readOnly: true });
    }
}

function initializeRegisters() {
    for (let r = 0; r < 35; r++) {
        const key = '$' + r;
        if (key in REGISTER_INITIAL_VALUES) {
            try {
                REGISTERS[r] = REGISTER_INITIAL_VALUES[key].read();
            } catch (e) {
                REGISTERS[r] = e.message;
            }
        } else if (r == 31) {
            REGISTERS[r] = 0xDEADC0DE;
        } else {
            REGISTERS[r] = 0;
        }
    }
}

function startRunning() {
    running = true;
    reassembleEverything();
    rightEditor.updateOptions({ readOnly: true });
    initializeRegisters();
    jumpTo(0);
}

function runStep() {
    if (!running) {
        startRunning();
        runEnd = null;
        displayStatus();
    } else {
        runEnd = "step";
        try {
            continueRunning();
        } finally {
            runEnd = null;
        }
    }
}

function pauseRunning() {
    runEnd = "now";
}

function runOne(instruction) {
    instruction.execute();
    displayStatus();
    if (getPC() === 0xDEADC0DE) {
        stop();
    } else if (runEnd === "return") {
        runEnd = null;
    }
}

function continueRunning() {
    const pc = getPC();

    if ((runEnd === "now") || (runEnd == pc)) {
        runEnd = null;
        return;
    }

    if (!running) return;

    try {
        const instruction = getCurrentInstruction();
        if (instruction instanceof JrInstruction) {
            if (instruction.s.registerNumber === 31) {
                runOne(instruction);
            } else {
                runOne(instruction);
            }
        } else {
            runOne(instruction);
        }



        if (!hasBreakpoint(getPC())) {
            if ((runEnd !== null) && (runEnd !== "step")) {
                window.setTimeout(continueRunning, 50);
            }
        }
    } catch (e) {
        alert(e.message);
        runEnd = null;
    }
}

function runToReturn() {
    if (!running) startRunning();
    runEnd = "return";
    continueRunning();
}

function runToLine(event) {
    const position = event.getPosition();
    const lineNumber = position.lineNumber;
    let lineAddress;
    try {
        lineAddress = completeAssembly[lineNumber - 1].address;
    } catch (e) {
        alert("This line does not have an address: " + e.message);
        return;
    }

    if (!running) startRunning();

    runEnd = lineAddress;

    continueRunning();
}

function runToEnd() {
    if (!running) startRunning();
    runEnd = "end";
    continueRunning();
}

function stop() {
    if (!running) return;
    running = false;
    runEnd = null;
    displayStatus();
}

function stopReset() {
    stop();
    reassembleEverything();
    rightEditor.updateOptions({ readOnly: false });
}

function hasDecoration(className, lineNumber) {
    const model = rightEditor.getModel();
    const decorations = model.getDecorationsInRange(new monaco.Range(lineNumber, 1, lineNumber, 1));
  
    return decorations.some(dec => dec.options.className === className);
}

function hasBreakpoint(address) {
    const lineNumber = lineMap[address];
    return (lineNumber) ? hasDecoration("breakpointHighlight", lineNumber) : false;
}

function removeDecorations(className, lineNumber, toLineNumber) {
    for (let editor of [leftEditor, rightEditor]) {
        const model = editor.getModel();
        const decorations = model.getDecorationsInRange(new monaco.Range(lineNumber ?? 1, 1, toLineNumber ?? lineNumber ?? model.getLineCount(), 1));
    
        const toRemove = decorations.filter(dec => dec.options.className === className).map(dec => dec.id);
    
        if (toRemove.length > 0) {
            editor.deltaDecorations(toRemove, []);
        }
    }
}

function addDecoration(className, lineNumber) {
    if (!hasDecoration(className, lineNumber)) {
        for (let editor of [leftEditor, rightEditor]) {
            editor.deltaDecorations([], [{
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: className,
                }
            }]);
        }
    }
}

function toggleBreakpoint(lineNumber) {
    if (hasDecoration("breakpointHighlight", lineNumber)) {
        removeDecorations("breakpointHighlight", lineNumber);
    } else {
        addDecoration("breakpointHighlight", lineNumber);
    }
}

function highlightRegisterAccess(registerNumber, className) {
    const val = document.getElementById(`val-${registerNumber}`);
    if (val) {
        val.parentElement.className = className ?? 'registerAccess';
    }
}

function highlightMemoryAccess(address) {
    const lineNumber = lineMap[address];
    if (lineNumber) {
        addDecoration("memoryAccess", lineNumber);
        rightEditor.revealLine(lineNumber);
    }
}

function displayStatus() {
    for (let r = 0; r < 35; r++) {
        const val = document.getElementById(`val-${r}`);
        if (val) {
            const registerValue = REGISTERS[r];
            if (typeof registerValue === 'string') {
                val.className = 'error';
            } else {
                val.className = null;
            }
            val.innerText = describeValue(registerValue);                
            val.parentElement.className = null;            
        }
    }

    removeDecorations("memoryAccess");

    if (running) {
        const pc = getPC();
        if (pc != 0xDEADC0DE) {
            let currentLine = lineMap['' + pc];

            if (currentLine) {
                leftDecorations = leftEditor.deltaDecorations(leftDecorations, [
                    {
                        range: new monaco.Range(currentLine, 1, currentLine, 1),
                        options: {
                            isWholeLine: true,
                            className: 'nextToExecuteHighlight'
                        }
                    }
                ]);

                rightDecorations = rightEditor.deltaDecorations(rightDecorations, [
                    {
                        range: new monaco.Range(currentLine, 1, currentLine, 1),
                        options: {
                            isWholeLine: true,
                            className: 'nextToExecuteHighlight'
                        }
                    }
                ]);            
            }

            const instruction = getCurrentInstruction();
            if (instruction)  {
                instruction.highlightOperands();
            }

            if (currentLine) {
                rightEditor.revealLine(currentLine);
            }
        }
    } else {
        leftDecorations = leftEditor.deltaDecorations(leftDecorations, []);
        rightDecorations = rightEditor.deltaDecorations(rightDecorations, []);
    }

    stdin.value = STDIN_REMAINING;
    stdout.value = STDOUT;
}

require.config({ paths: { "vs": monacoBaseUrl + "vs/" } });

window.MonacoEnvironment = {
    getWorkerUrl: function (workerId, label) {
        return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = { baseUrl: "${monacoBaseUrl}" };
        importScripts("${monacoBaseUrl}/vs/base/worker/workerMain.min.js");`
        )}`;
    }
};

require(['vs/editor/editor.main'], function () {
    monaco.languages.register({ id: 'sdiw' });
    monaco.languages.setMonarchTokensProvider('sdiw', sdiwLanguage);
    monaco.languages.setLanguageConfiguration('sdiw', sdiwConf);

    monaco.languages.register({ id: 'sdiw-gutter' });
    monaco.languages.setMonarchTokensProvider('sdiw-gutter', sdiwGutterLanguage);
    monaco.languages.setLanguageConfiguration('sdiw-gutter', sdiwGutterConf);


    leftEditor = monaco.editor.create(leftEditorElement, {
        value: sdiwIntroSample.replace(/[^\r\n]/gm, ''),
        language: 'sdiw-gutter',
        readOnly: true,
        lineNumbers: 'off',
        minimap: { enabled: false },
        scrollbar: { vertical: 'hidden' },
        automaticLayout: true,
        fontLigatures: true,
        glyphMargin: false,
        lineNumbersMinChars: 0,
        lineDecorationWidth: 0
    });

    rightEditor = monaco.editor.create(rightEditorElement, {
        value: sdiwIntroSample,
        language: 'sdiw',
        readOnly: false,
        lineNumbers: 'on',
        minimap: { enabled: false },
        scrollbar: { vertical: 'auto' },
        automaticLayout: true,
        fontLigatures: false,
        glyphMargin: true,
        lineNumbersMinChars: 4,
        lineDecorationWidth: 200

    });

    const monacoKeyMod = monaco.KeyMod;
    const monacoKeyCode = monaco.KeyCode;

    for (const editor of [leftEditor, rightEditor]) {
        editor.addAction({
            id: "toggle-breakpoint",
            label: "Toggle Breakpoint",
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.0,
            keybindings: [monacoKeyCode.F9],
            run: (e) => toggleBreakpoint(e.getPosition().lineNumber)
        });

        editor.addAction({
            id: "run-single-step",
            label: "Run a single step",
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.1,
            keybindings: [monacoKeyCode.F11],
            run: runStep
        });

        editor.addAction({
            id: "run-to-return",
            label: "Run up to jr $31",
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.2,
            keybindings: [monacoKeyMod.Shift | monacoKeyCode.F11],
            run: runToReturn
        });


        editor.addAction({
            id: "run-to-here",
            label: "Run up to this line",
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.3,
            keybindings: [monacoKeyMod.Ctrl | monacoKeyCode.F10],
            run: runToLine
        });

        editor.addAction({
            id: "run-to-end",
            label: "Start/Continue",
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.4,
            keybindings: [monacoKeyCode.F5],
            run: runToEnd
        });

        editor.addAction({
            id: "pause",
            label: "Pause",
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.5,
            keybindings: [monacoKeyMod.Shift | monacoKeyCode.F5],
            run: pauseRunning
        });

        editor.addAction({
            id: "stop",
            label: "Stop",
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.6,
            keybindings: [],
            run: stop
        });
    }

    for (editor of [rightEditor]) {
        editor.onMouseDown(e => {
            if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                toggleBreakpoint(e.target.position.lineNumber);
            }
        });
    }

    // Sync vertical scrolling between editors
    let isSyncing = false;

    function syncScroll(fromEditor, toEditor) {
        fromEditor.onDidScrollChange(e => {
            if (isSyncing) return;
            isSyncing = true;
            const targetScrollTop = fromEditor.getScrollTop();
            const targetScrollLeft = fromEditor.getScrollLeft();
            toEditor.setScrollTop(targetScrollTop);
            toEditor.setScrollLeft(targetScrollLeft);
            isSyncing = false;
        });
    }

    syncScroll(leftEditor, rightEditor);
    syncScroll(rightEditor, leftEditor);

    // Initial sync
    reassembleEverything();

    // React to content changes in right editor
    rightEditor.onDidChangeModelContent((event) => {
        updateAssembly(event);
    });
});
