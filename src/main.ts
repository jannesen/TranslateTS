// C:\Local\TVCN\TAS\Src\TAS2.Internet>..\..\..\JLib\Tools\TranslateTS\node.exe ..\..\..\JLib\Tools\TranslateTS tasnet3\tasnet\resources\language.nl.ts tasnet3\tasnet\resources\language.de.ts
import * as $fs from "fs";
import * as $path from "path";
import * as $https from "https";
import * as $ts from "typescript/lib/typescript";

const config = JSON.parse($fs.readFileSync($path.dirname($path.dirname(module.filename)) + "\\config.json", { encoding:"utf8" }));
const process_cwd = process.cwd();
let   error_count = 0;

interface IError
{
    filename:       string;
    lineno?:        number;
    column?:        number;
    message:        string;
}

export interface MapLike<T> {
    [index:string]: T;
}

function createDictionaryObject<T>():MapLike<T> {
    const map = Object.create(null);

    map["__"] = undefined;
    delete map["__"];

    return map;
}

//-------------------------------------------------------------------------------------------------
// AutoTranslate
//
class TranslateTS
{
    public      target_filename:        string;
    public      template_filename:      string;
    public      target_language:        string;
    public      template_language:      string;
    public      program:                $ts.Program;
    public      typechecked:            $ts.TypeChecker;
    public      errors:                 IError[];
    public      target_sourcefile:      $ts.SourceFile;
    public      template_sourcefile:    $ts.SourceFile;

    constructor(target_filename:string)
    {
        this.target_filename = target_filename;
        this.errors          = [];
    }

    public load()
    {
        try {
            if (this._readfileparameters()) {
                const compileoptions = this._readtsconfig();

                if (compileoptions) {
                    return this._createProgram(compileoptions);
                }
            }
        } catch (e) {
            this.errors.push({filename: this.target_filename, message: e.message});
        }

        return false;
    }

    public async process()
    {
        const target_text           = this.target_sourcefile.text;
        const template_text         = this.template_sourcefile.text;
        const target_statements     = this._getStatements(this.target_sourcefile);
        const template_statements   = this._getStatements(this.template_sourcefile);
        const target_statements_map = createDictionaryObject<Statement>();

        // Init
        for (const s of target_statements) {
            if (s.name) {
                target_statements_map[s.name] = s;
            }
        }

        const outsegments = [ "\ufeff" ];
        const totranslate = [] as { idx: number, txt: string }[];

        // Copy Init and statements from target_statements to outsegments
        for (const s of target_statements) {
            if (s.kind === StatementKind.Init || s.kind === StatementKind.Statement) {
                outsegments.push(target_text.substring(s.pos, s.end));
            }
        }

        // Copy ExportConst from template_statements and translate to outsegments.
        for (const s of template_statements) {
            if (s.kind === StatementKind.ExportConst) {
                outsegments.push(template_text.substring(s.pos, s.valueNode.getStart()));

                if (s.valueNode.kind === $ts.SyntaxKind.StringLiteral) {
                    outsegments.push("/*" + template_text.substring(s.valueNode.getStart() + 1, s.valueNode.end - 1) + "*/ ");
                }

                const t = target_statements_map[s.name];

                if (t) {
                    outsegments.push(target_text.substring(t.valueNode.getStart(), t.valueNode.end));
                } else {
                    if (s.valueNode.kind === $ts.SyntaxKind.StringLiteral) {
                        totranslate.push({ idx:outsegments.length, txt:decodeStringLiteral(template_text.substring(s.valueNode.getStart() + 1, s.valueNode.end - 1))});
                    }

                    outsegments.push("!! TODO !!");
                }

                outsegments.push(template_text.substring(s.valueNode.end, s.end));
            }
        }

        // Copy Suffix from target_statements tp outsegments
        for (const s of target_statements) {
            if (s.kind === StatementKind.Suffix) {
                outsegments.push(target_text.substring(s.pos, s.end));
            }
        }

        // Copy Suffix from target_statements tp outsegments
        while (totranslate.length > 0) {
            let n = 0;
            let s = 0;

            while (n < 32 && n < totranslate.length) {
                if ((s += totranslate[n].txt.length) > 5000)
                    break;

                ++n;
            }

            const batch  = totranslate.splice(0, n);
            const result = await translate(batch.map((t) => t.txt), this.template_language, this.target_language);
            for (n = 0; n < batch.length; ++n) {
                outsegments[batch[n].idx] = "\"" + encodeStringLiteral(result[n]) + "\"";
            }
        }

        $fs.writeFileSync(this.target_filename, outsegments.join(""), { encoding: "utf8" });
    }

    private _readfileparameters()
    {
        const target_text = $fs.readFileSync(this.target_filename, { encoding:"utf8" });

        if (!(this.template_filename = getExportInterface(this.target_filename, target_text))) {
            this.errors.push({ filename:this.target_filename, message:"Missing /// <export-interface path=\"...\"/>"});
        }

        if (!(this.target_language = getLanguage(target_text))) {
            this.errors.push({ filename:this.target_filename, message:"Missing /// <language code=\"...\"/>"});
        }

        const template_text = $fs.readFileSync(this.template_filename, { encoding:"utf8" });

        if (!(this.template_language = getLanguage(template_text))) {
            this.errors.push({ filename:this.template_filename, message:"Missing /// <language code=\"...\"/>"});
        }

        return this.errors.length === 0;
    }
    private _readtsconfig()
    {
        let dirname = $path.dirname(this.target_filename);

        while (dirname) {
            const tsconfigfn = $path.join(dirname, "/tsconfig.json");
            if ($fs.existsSync(tsconfigfn)) {
                const read_result = $ts.readConfigFile(tsconfigfn, (fn) => $fs.readFileSync(fn, {encoding:"utf8"}) );
                if (read_result.error) {
                    throw new Error(tsconfigfn + ": " + read_result.error.messageText);
                }

                const parse_result = $ts.convertCompilerOptionsFromJson(read_result.config.compilerOptions, dirname);
                if (this._addDiagnostics(parse_result.errors)) {
                    return undefined;
                }

                return Object.assign<$ts.CompilerOptions, $ts.CompilerOptions>({}, parse_result.options);
            }

            const d = $path.dirname(dirname);
            dirname = (d !== dirname) ? d : null;
        }

        throw new Error("Can't find tsconfig.json");
    }
    private _createProgram(compileoptions:$ts.CompilerOptions)
    {
        compileoptions.noEmit         = true;
        compileoptions.noEmitOnError  = true;
        compileoptions.out            = undefined;
        compileoptions.outDir         = undefined;
        compileoptions.outFile        = undefined;
        compileoptions.sourceMap      = false;
        compileoptions.removeComments = false;
        if (!compileoptions.types) {
            compileoptions.types = [];
        }

        this.program     = $ts.createProgram([ this.template_filename, this.target_filename ], compileoptions);

        if (this._addDiagnostics($ts.getPreEmitDiagnostics(this.program))) {
            return false;
        }

        this.typechecked = this.program.getTypeChecker();

        if (!(this.target_sourcefile = this.program.getSourceFile(this.target_filename))) {
            this.errors.push({ filename:this.target_filename, message:"Can't find file in program."});
        }
        if (!(this.template_sourcefile = this.program.getSourceFile(this.template_filename))) {
            this.errors.push({ filename:this.template_filename, message:"Can't find file in program."});
        }

        return this.errors.length === 0;
    }
    private _getStatements(sourcefile:$ts.SourceFile)
    {
        const statements = [] as Statement[];

        const text = sourcefile.text;
        const textlength = text.length;
        let pos = 0;

        while (pos + 1 < textlength && text.charCodeAt(pos) === 47 && text.charCodeAt(pos + 1) === 47) {
            if ((pos = text.indexOf("\n", pos)) > 0) {
                ++pos;
                if (pos < textlength && text.charCodeAt(pos) === 13) {
                    ++pos;
                }
            } else {
                pos = textlength;
            }
        }

        if (pos > 0) {
            statements.push(new Statement(StatementKind.Init, 0, pos, undefined));
        }

        sourcefile.statements.forEach((tsstatement) => {
                if (tsstatement.pos > pos || tsstatement.getStart() < pos) {
                    throw new Error("Statements out of order");
                }

                let end = tsstatement.end;

                while (end < textlength && (text.charCodeAt(end) === 9 || text.charCodeAt(end) === 32)) {
                    ++end;
                }

                if (end + 1 < textlength && text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10) {
                    end += 2;
                } else if (end + 1 < textlength && text.charCodeAt(end) === 10 && text.charCodeAt(end + 1) === 13) {
                    end += 2;
                } else if (end < textlength && text.charCodeAt(end) === 10) {
                    end += 1;
                }

                statements.push(new Statement(StatementKind.Statement, pos, end, tsstatement));
                pos = end;
            });

        if (pos < textlength) {
            statements.push(new Statement(StatementKind.Suffix, pos, textlength, undefined));
        }

        return statements;
    }

    private _addDiagnostics(diagnostics:readonly $ts.Diagnostic[])
    {
        if (diagnostics && diagnostics.length > 0) {
            diagnostics.forEach((diagnostic) => {
                const filename = diagnostic.file ? diagnostic.file.fileName : undefined;
                const pos      = diagnostic.file ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
                const lineno   = pos ? pos.line + 1      : undefined;
                const column   = pos ? pos.character + 1 : undefined;

                if (typeof diagnostic.messageText === "string") {
                    this.errors.push({ filename, lineno, column, message: diagnostic.messageText });
                } else {
                    logDiagnosticMessageChain(diagnostic.messageText, 0);

                    function logDiagnosticMessageChain(diagnosticChain:$ts.DiagnosticMessageChain, indent:number) {
                        this.errors.push({ filename, lineno, column, message:"  ".repeat(indent) + diagnosticChain.messageText });

                        if (diagnosticChain.next) {
                            for (const n of diagnosticChain.next) {
                                logDiagnosticMessageChain(n, indent + 1);
                            }
                        }
                    }
                }
            });
            return true;
        }
        return false;
    }
}

const enum StatementKind
{
    Init,
    Statement,
    ExportConst,
    Suffix
}

class Statement
{
    public      kind:       StatementKind;
    public      pos:        number;
    public      end:        number;
    public      tsstatment: $ts.Statement;
    public      name:       string;
    public      valueNode:  $ts.Node;

    constructor(kind:StatementKind, pos:number, end:number, tsstatment:$ts.Statement)
    {
        this.kind       = kind;
        this.pos        = pos;
        this.end        = end;
        this.tsstatment = tsstatment;

        if (tsstatment && tsstatment.kind === $ts.SyntaxKind.VariableStatement) {
            const l1_children = tsstatment.getChildren();

            if (l1_children.length === 3 &&
                l1_children[0].kind === $ts.SyntaxKind.SyntaxList &&
                l1_children[1].kind === $ts.SyntaxKind.VariableDeclarationList &&
                l1_children[2].kind === $ts.SyntaxKind.SemicolonToken &&
                l1_children[0].getText() === "export") {
                const l2_children = l1_children[1].getChildren();

                if (l2_children.length === 2 &&
                    l2_children[0].kind === $ts.SyntaxKind.ConstKeyword &&
                    l2_children[1].kind === $ts.SyntaxKind.SyntaxList) {
                    const l3_children = l2_children[1].getChildren();

                    if (l3_children.length === 1 &&
                        l3_children[0].kind === $ts.SyntaxKind.VariableDeclaration) {
                        const l4_children = l3_children[0].getChildren();

                        if (l4_children.length === 3 &&
                            l4_children[0].kind === $ts.SyntaxKind.Identifier &&
                            l4_children[1].kind === $ts.SyntaxKind.FirstAssignment) {
                            this.kind      = StatementKind.ExportConst;
                            this.name      = l4_children[0].getText();
                            this.valueNode = l4_children[2];
                        }
                    }
                }
            }
        }
    }
}

//-------------------------------------------------------------------------------------------------
// Helper functions
//
const regex_exportinterface = /\/\/\/\s*<export-interface\s+path\s*=\s*('|")(.+?)('|")\s*\/>/im;
function getExportInterface(filename:string, filetext:string)
{
    const match = regex_exportinterface.exec(filetext);
    return match ? $path.resolve($path.dirname(filename), match[2]) : undefined;
}

const regex_language        = /\/\/\/\s*<language\s+code\s*=\s*('|")(.+?)('|")\s*\/>/im;
function getLanguage(filetext:string)
{
    const match = regex_language.exec(filetext);
    return match ? match[2] : undefined;
}

function decodeStringLiteral(s:string) {
    let i = 0;

    while (i < s.length) {
        if (s.charCodeAt(i) === 134) {
            switch (s.charAt(i + 1)) {
            case "\\":      replace(2, "\\");                                                       break;
            case "\"":      replace(2, "\"");                                                       break;
            case "\'":      replace(2, "\'");                                                       break;
            case "n":       replace(2, "\n");                                                       break;
            case "t":       replace(2, "\t");                                                       break;
            case "r":       replace(2, "\r");                                                       break;
            case "b":       replace(2, "\b");                                                       break;
            case "u":       replace(6, String.fromCharCode(parseInt(s.substr(i + 2, 4), 16)));      break;
            }
        }

        ++i;
    }

    return s;

    function replace(l:number, c:string) {
        s = s.substring(0, i) + c + s.substring(i + l);
        i = l - 1;
    }
}

function encodeStringLiteral(s:string) {
    let i = 0;

    while (i < s.length) {
        switch(s.charCodeAt(i) ) {
        case   7:   replace("\b");  break;
        case   9:   replace("\t");  break;
        case  10:   replace("\n");  break;
        case  13:   replace("\r");  break;
        case  34:   replace("\"");  break;
        case  39:   replace("\'");  break;
        case 134:   replace("\\");  break;
        }

        ++i;
    }

    return s;

    function replace(c:string) {
        s = s.substring(0, i) + c + s.substring(i + 1);
    }
}

function logError(errors:IError[])
{
    if (errors) {
        errors.forEach((err) => {
            if (typeof err.filename === "string") {
                let m = $path.relative(process_cwd, err.filename);

                if (err.lineno > 0) {
                    m += "(" + err.lineno;
                    if (err.column > 0) {
                        m += "," + err.column;
                    }
                    m += ")";
                }

                console.log(m + ": " + err.message);
            } else {
                console.log(err.message);
            }

            error_count++;
        });
    }
}

//-------------------------------------------------------------------------------------------------
// Translate
//
async function translate(txt:string[], source:string, target:string) {
    return new Promise<string[]>((resolve, reject) => {
        if (config.apikey) {
            const request = $https.request({
                hostname:   "translation.googleapis.com",
                method:     "POST",
                path:       "/language/translate/v2?key=" + encodeURI(config.apikey) + "&alt=json",
                timeout:    30000,
                headers:    {
                    "Content-Type": "application/json",
                }
            },
                (response) => {
                    if (response.statusCode !== 200) {
                        reject(new Error("translation.googleapis.com returns status code: " + response.statusCode));
                    }
                    response.setEncoding("utf8");
                    let body = [] as string[];
                    response.on("data", (chunk) => {
                        if (body) {
                            if (typeof chunk === "string") {
                                body.push(chunk);
                            } else {
                                body = null;
                                reject(new Error("Failed to load page, binary data received."));
                            }
                        }
                    });
                    response.on("end", () => {
                        if (body) {
                            try {
                                const result = JSON.parse(body.join(""));
                                const resulttxt = result && result.data && result.data.translations && result.data.translations.map((n:any) => n.translatedText);

                                if (resulttxt && resulttxt.length === txt.length) {
                                    resolve(resulttxt);
                                } else {
                                    reject(new Error("Invalid response received from google cloud."));
                                }
                            } catch (e) {
                                reject(e);
                            }
                        }
                    });
                });
            request.on("error", (err) => reject(err));
            request.write(JSON.stringify({
                q: txt,
                source: source,
                target: target
            }));
            request.end();
        } else {
            resolve(txt.map(() => "!!TODO!!"));
        }
    });
}

//-------------------------------------------------------------------------------------------------
// main
//

async function main() {
    const   argv = process.argv;

    for (let i = 2 ; i < argv.length ; ++i) {
        const autoTranslate = new TranslateTS($path.resolve(process_cwd, argv[i]));
        if (autoTranslate.load()) {
            console.log("autotranslate: " + $path.relative(process_cwd, autoTranslate.template_filename) + " => " + $path.relative(process_cwd, autoTranslate.target_filename));

            await autoTranslate.process();
        }

        logError(autoTranslate.errors);
    }
}

main()
    .then(()         => { console.log(error_count ? "AutoTranslate failed." : "AutoTranslate done."); })
    .catch((e:Error) => { console.log("ERROR: " + e.message); });
