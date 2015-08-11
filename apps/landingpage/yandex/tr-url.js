/*global Breaker, Model, Node */
(function (namespace) {
'use strict';

var util = namespace.ya_.util, json = namespace.ya_.json, ajax = namespace.ya_.ajax;

////////////////////////////////////////////////////////////////////////////////
//
// Doc
//

var Doc = function (sid, url) {
    this.sid = sid;
    this.url = url;
    this.srv = "tr-url";
    this.trid = 0; // translation id
    this.rid = 0; // request id
    this.isPdf = Doc.checkPdf();
    this.defLang = "";
    this.state = 0;
    this.window = window;
    this.doc = document;
    this.model = null;
    this.listener = this;
    var loc = document.location;
    this.trUrl = loc.protocol + "//" + loc.host + "/api/v1/tr.json";
    this.protocol = this.trUrl.indexOf(".json") >= 0 ? "json" : "xml";
    this.initTranslation("");
    this.bgTimer = null;
    this.observer = null;
    this.isDirty = false;  // true if observer detected DOM mutation
};

Doc.STATE_INIT = 0;
Doc.STATE_LOAD_START = 1;
Doc.STATE_LOAD_END = 2;
Doc.STATE_TR_START = 3;
Doc.STATE_TR_END = 4;
Doc.STATE_UNLOAD = 5;
Doc.STATE_INACCESSIBLE = 6;

var SKIP_TAGS = { audio: 1, base: 1, canvas: 1, embed: 1, link: 1, meta: 1, noembed: 1,
    noscript: 1, object: 1, script: 1, style: 1, svg: 1, video: 1 };
var BUTTONS = { button: 1, reset: 1, submit: 1 };
var FRAME_TAGS = { iframe: 1, frame: 1 };
var INLINE_TAGS = { a: 1, abbr: 1, acronym: 1, b: 1, bdo: 1, big: 1, cite: 1, code: 1, dfn: 1,
    em: 1, i: 1, kbd: 1, q: 1, samp: 1, small: 1, span: 1, strong: 1, sub: 1, sup: 1, tt: 1,
    u: 1, var: 1 };
var TEXT_ATTRS = { img: "alt", input: "placeholder", textarea: "placeholder" };
var ENTITY = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' };
var MAX_BLOCK_LEN = navigator.userAgent.indexOf("MSIE") >= 0 ? 300 : 600;
var MAX_ITEMS = 20;
var MAX_THREADS = 5;
var MAX_REPEAT = 2;

Doc.checkPdf = function () {
    var metas = document.getElementsByTagName("meta"), meta, name, value, i;
    for (i = 0; i < metas.length; ++i) {
        meta = metas[i];
        name = meta.getAttribute("name");
        value = meta.getAttribute("content") || "";
        if (name == "generator" && value.substr(0, 15) == "yandex-pdf2html") {
            return true;
        }
    }
    return false;
};

Doc.prototype.changeState = function (newState) {
    this.state = newState;
    this.listener.onStateChanged(this);
};

Doc.prototype.getState = function () {
    return this.state;
};

Doc.prototype.initTranslation = function (lang) {
    this.trid += 1;
    this.lang = lang;
    this.errCount = 0;
    this.counters = { allowErr: 5, good: 0, maxGood: 9 };  // MT-1006
    this.threads = 0;
    this.errIds = {};
    this.isDirty = false;
};

Doc.prototype.setSrv = function (srv) {
    this.srv = srv;
};

Doc.prototype.undo = function () {
    this.initTranslation("");
    this.model.undo();
};

Doc.prototype.startTranslation = function (lang, bg) {
    this.attachDoc();

    var ref = this;
    this.defLang = lang;
    this.changeState(Doc.STATE_LOAD_START);

    var delayedStart = function () {
        setTimeout(function () { ref.translate("", bg); }, 1000);
    };
    this.doc.addEventListener("DOMContentLoaded", delayedStart, false); // MT-512, MT-841
    this.window.addEventListener("load", function () {
        ref.changeState(Doc.STATE_LOAD_END);
        delayedStart();
    }, false);
    this.window.addEventListener("unload",
        function () { ref.changeState(Doc.STATE_UNLOAD); }, false);
};

Doc.prototype.translate = function (lang, bg) {
    lang = lang || this.defLang;
    if (!lang || /^(\w+)-\1$/.test(lang)) {
        return;
    }
    if (lang == this.lang && !this.errCount) {  // Issue: BAR-15870
        return;
    }

    this.initTranslation(lang);
    this.changeState(Doc.STATE_TR_START);
    this.listener.onProgressChanged(0);

    this.model = new Model(this, this.lang);
    this.model.update();
    this.content = this.model.content;
    this.startThreads();

    if (bg && !this.isPdf) {
        this.bg();
    }
};

Doc.prototype.attachDoc = function () {
    try {
        if (parent != window && parent.yandexTr) {
            parent.yandexTr.onLoadDoc(this);
        }
    } catch (ignore) {
    }
};

Doc.prototype.update = function () {
    if (!this.isDirty || !this.lang || !this.model.update()) {
        this.isDirty = false;
        return;
    }
    this.initTranslation(this.lang);
    this.content = this.model.content;
    this.startThreads();
};

Doc.prototype.startThreads = function () {
    var ref = this, trid = this.trid, i;
    var translate = function () { ref.doTranslate(ref.model, trid); };
    for (i = 0; i < MAX_THREADS; ++i) {
        setTimeout(translate, 0);
    }
};

Doc.prototype.bg = function () {
    var ref = this;
    if (!this.observer && window.MutationObserver) {
        this.observer = new window.MutationObserver(function() { ref.isDirty = true; });
        this.observer.observe(document.body,
            { characterData: true, childList: true, subtree: true });
    }
    if (!this.bgTimer) {
        this.bgTimer = setInterval(function () { ref.onIdle(); }, 1000);
    }
};

Doc.prototype.onIdle = function () {
    if (this.lang && this.state == Doc.STATE_TR_END) {
        this.update();
    }
};

function getChunkLen(chunk) {
    var len = 0, i, spans = chunk.spans;
    for (i = 0; i < spans.length; ++i) {
        len += spans[i].text.length;
    }
    return len;
}

function isChunkTranslated(chunk) {
    var i = 0, spans = chunk.spans;
    while (i < spans.length && spans[i].tr) {
        ++i;
    }
    return i == spans.length;
}

Doc.prototype.doTranslate = function (obj, trid) {
    if (this.trid != trid) {
        return;
    }
    var text = [], textLen = 0, startIndex = obj.index;
    var chunks = obj.content, i, n = chunks.length, chunk, span;
    for (i = startIndex; i < n && isChunkTranslated(chunks[i]); ++i) {
        this.model.skipTranslated(chunks[i]);
    }
    obj.index = startIndex = i;
    for (i = startIndex; i < n && text.length < MAX_ITEMS; ++i) {
        chunk = chunks[i];
        span = chunk.spans[0];
        if (i == startIndex && span.content) {
            ++obj.index;
            span.index = 0;
            this.doTranslate(span, trid);
            return;
        }
        textLen += getChunkLen(chunk);
        if ((i > startIndex && textLen > MAX_BLOCK_LEN) ||
                span.content || isChunkTranslated(chunk)) {
            break;
        }
        text.push(chunk);
    }
    obj.index = i;
    if (text.length) {
        this.translateArray(obj, startIndex, text);
        return;
    }
    if (obj != this.model) {
        this.doTranslate(this.model, trid);  // continue translation of main stream
        return;
    }
    if (++this.threads == MAX_THREADS) {
        if (this.trPopup) {
            this.trPopup.setLang(this.lang.split('-')[0]);
            this.trPopup.wrapSentences(this.content);
        }
        this.changeState(Doc.STATE_TR_END);
    }
};

Doc.prototype.translateArray = function (obj, index, textArr) {
    var ref = this;

    var text = [], i, j, html, spans;
    for (i = 0; i < textArr.length; ++i) {
        html = "";
        spans = textArr[i].spans;
        for (j = 0; j < spans.length; ++j) {
            if (j) {
                html += "<wbr/>";
            }
            html += util.htmlEncode(spans[j].text);
        }
        text[i] = html;
    }

    var args = { lang: this.lang, format: "html", text: text,
        srv: this.srv, id: this.sid + "-" + (this.rid++)
        };
    if (this.trPopup) {
        args.options = 2;
    }
    var query = { args: args, url: this.trUrl + "/translate", method: "POST",
        callback: function (result, error) { ref.onResponse(query, result, error); },
        obj: obj, index: index, trid: this.trid
        };

    var firstSpan = textArr[0].spans[0];
    if (firstSpan.text.length > MAX_BLOCK_LEN) {
        this.onResponse(query, {
            text: text,
            align: []
        });
        return;
    }

    this.sendQuery(query);
};

Doc.prototype.sendQuery = function (query) {
    if (this.protocol == "xml") {
        ajax.sendQuery(query);
    } else {
        json.sendQuery(query);
    }
};

Doc.prototype.onProgressChanged =
    Doc.prototype.onStateChanged =
    Doc.prototype.onError = function () { return undefined; };

Doc.prototype.onLoadDoc = function (doc) {
    doc.setListener(this);
};

Doc.prototype.onReady = function () {
    var ref = this;
    var lastNode = this.getLastNode();
    setTimeout(function () { if (ref.getLastNode() == lastNode) { ref.translate(); } }, 1000);
};

Doc.prototype.onResult = function (query, textArr) {
    var ref = this, trid = this.trid;
    this.model.setTranslation(query.obj, query.index, textArr);
    var progress = Math.floor(this.model.trTextLen * 100 / this.model.textLen + 0.5);
    this.listener.onProgressChanged(progress);
    setTimeout(function () { ref.doTranslate(query.obj, trid); }, 1);
};

function selectValuesByTag(parent, tagName) {
    var i, n, node, result = [], element,
        elements = parent.getElementsByTagName(tagName);

    for (i = 0, n = elements.length; i < n; i++) {
        element = elements[i];
        node = element.firstChild;
        result.push(node ? node.nodeValue : '');
    }

    return result;
}

Doc.prototype.onResponse = function (query, result, error) {
    if (this.trid != query.trid) {
        return;
    }

    var c = this.counters, queryId = query.args.id;
    if (error) {
        this.errIds[queryId] = (this.errIds[queryId] || 0) + 1;
        if (--c.allowErr >= 0 && this.errIds[queryId] <= MAX_REPEAT) {
            this.sendQuery(query);
        } else if (++this.errCount == 1) {
            this.listener.onError(error);
        }
        return;
    }

    if (++c.good >= c.maxGood) {
        ++c.allowErr;
        c.good = 0;
    }

    var i, j, text, align, chunk, textArr = [];
    if (this.protocol == "xml") {
        text = selectValuesByTag(result.responseXML, 'text');
        align = selectValuesByTag(result.responseXML, 'align');
    } else {
        text = result.text;
        align = result.align || [];
    }

    for (i = 0; i < text.length; ++i) {
        chunk = text[i].split(/<wbr\s?\/>/);
        for (j = 0; j < chunk.length; ++j) {
            chunk[j] = Doc.htmlDecode(chunk[j]);
        }
        textArr[i] = {
            text: chunk,
            align: align[i]
        };
    }

    this.onResult(query, textArr);
};

Doc.htmlDecode = function (html) {
    var result = "", pos, entity;
    for (;;) {
        pos = html.indexOf('&');
        if (pos < 0) {
            result += html;
            break;
        }
        result += html.substr(0, pos);
        html = html.substr(pos + 1);
        pos = html.indexOf(';');
        if (pos < 0) {
            pos = html.length;
        }
        entity = html.substr(0, pos);
        result += (ENTITY[entity] || '?');
        html = html.substr(pos + 1);
    }
    return result;
};

Doc.prototype.getLocation = function () {
    return this.doc.location;
};

Doc.prototype.setListener = function (listener) {
    this.listener = listener;
};

Doc.prototype.getLastNode = function () {
    var node = this.doc.documentElement;
    while (node.lastChild) {
        node = node.lastChild;
    }
    return node;
};

////////////////////////////////////////////////////////////////////////////////
//
// TrDic
//

function TrDic() {
    this.map = {};
}

TrDic.prototype.addSpan = function (span) {
    this.getList(span.tr, true).push(span);
};

TrDic.prototype.findSpan = function (text, node) {
    var list = this.getList(text), i;
    if (list) {
        for (i = 0; i < list.length; ++i) {
            if (list[i].node == node) {
                return list[i];
            }
        }
    }
    return null;
};

TrDic.prototype.getList = function (text, doAdd) {
    var list = null;
    if (this.map.hasOwnProperty(text)) {
        list = this.map[text];
    } else if (doAdd) {
        list = [];
        this.map[text] = list;
    }
    return list;
};

////////////////////////////////////////////////////////////////////////////////
//
// Model -- represents document model. Contains list of chunks.
// Document <p>Hello <a>world</a>! Some text...</p>... will be transformed into:
// content: [ chunk0, chunk1, ... ]
// chunk0: [{ text: "Hello ", node }, { text: "world", node }, { text: "! Some text...", node }]
// If text in some chunk item is too long -- it will be split by Breaker:
// chunkN: [{ text: "Long text...", node, content: [[ { text: "Long text...", node:{} }, ... ]]}]
//

function Model(doc, lang) {
    this.doc = doc;
    this.rootNode = doc.doc.documentElement;
    this.setLang(lang);
    this.reset();
}

Doc.Model = Model;  // export for testing

Model.prototype.reset = function () {
    this.content = [];
    this.changedLangs = [];
    this.prev = null;
    this.textLen = this.trTextLen = 0;
    this.isDirty = false;
    this.index = 0;
};

Model.prototype.setLang = function (lang) {
    this.lang = lang;
    this.dir = this.fromLang = this.toLang = "";
    if (lang) {
        var langs = lang.split("-");
        this.fromLang = langs[0];
        this.toLang = langs[1];
        if (util.getDirection(this.fromLang) != util.getDirection(this.toLang)) {
            this.dir = util.getDirection(this.toLang);
        }
    }
};

Model.setNodeValue = function (node, value) {
    var nodes = node.nodes, text = null, i;
    if (nodes) {
        text = this.splitText(value, nodes);
    }

    try {
        if (nodes) {
            for (i = 0; i < nodes.length; ++i) {
                nodes[i].nodeValue = text[i];
            }
        } else {
            node.nodeValue = value;
        }
    } catch (ignore) {} // avoid "Invalid argument" error in IE
};

Model.splitText = function (text, nodes) {
    var n = nodes.length, sLen = 0, trLen = text.length, i, pos = [],
        len = nodes[0].length, lenK, start, end = 0, result = [], str;
    for (i = 0; i < n; ++i) {
        sLen += nodes[i].length;
    }
    pos.push(len * trLen / sLen);
    if (n > 2) {
        lenK = (sLen - len - nodes[n - 1].length) * trLen / sLen / (n - 2);
        for (i = 1; i < n - 1; ++i) {
            len += lenK;
            pos.push(len);
        }
    }
    pos.push(trLen);

    for (i = 0; i < n; ++i) {
        start = end;
        end = Math.floor(pos[i]);
        if (".,;?!)]".indexOf(text[end]) >= 0) {
            ++end;
        }

        str = text.substring(start, end);
        if (util.isAlpha(text.charAt(end - 1)) && util.isAlpha(text.charAt(end))) {
            str += '-';
        }
        str = util.trim(str);
        result.push(str);
    }
    return result;
};

Model.parseAlign = function (align) {
    var i, n, chunk;

    if (!align) {
        return [];
    }

    align = align.split(';');

    for (i = 0, n = align.length; i < n; i++) {
        chunk = align[i];

        chunk = chunk.split('-');
        chunk[0] = chunk[0].split(':');
        chunk[1] = chunk[1].split(':');
        chunk[0][0] = Number(chunk[0][0]);
        chunk[0][1] = Number(chunk[0][1]) + chunk[0][0];
        chunk[1][0] = Number(chunk[1][0]);
        chunk[1][1] = Number(chunk[1][1]) + chunk[1][0];

        align[i] = chunk;
    }

    return align;
};

Model.prototype.undo = function () {
    this.textLen = this.trTextLen = 0;

    var i, j, spans, chunks = this.content;
    for (i = 0; i < chunks.length; ++i) {
        spans = chunks[i].spans;
        for (j = 0; j < spans.length; ++j) {
            Model.setNodeValue(spans[j].node, spans[j].text);
        }
    }

    var chLangs = this.changedLangs;
    for (i = 0; i < chLangs.length; ++i) {
        chLangs[i].setAttribute("lang", this.fromLang);
    }

    this.setLang("");
    this.reset();
};

Model.prototype.update = function () {
    var prev = this.prev || Model.getRefs(this.content);
    var prevChangedLangs = this.changedLangs;
    this.reset();
    this.prev = prev;
    this.changedLangs = prevChangedLangs;
    this.visit(this.rootNode, [], true);
    this.breakChunks();

    var result = this.isDirty;
    if (this.isDirty) {
        this.prev = null;
    }
    this.isDirty = false;
    return result;
};

Model.getRefs = function (content) {
    var refs = new TrDic(), i, j, spans;
    for (i = 0; i < content.length; ++i) {
        spans = content[i].spans;
        for (j = 0; j < spans.length; ++j) {
            refs.addSpan(spans[j]);
        }
    }
    return refs;
};

Model.prototype.visit = function (node, chunk, translationMode) {
    if (!node) {  // Issue: MT-56
        return;
    }

    if (node.nodeType == Node.TEXT_NODE) {
        if (translationMode) {
            chunk.push(node);
        }
    } else if (node.nodeType == Node.ELEMENT_NODE) {
        this.visitElement(node, chunk, translationMode);
    }
};

Model.prototype.visitElement = function (node, chunk, translationMode) {
    var tagName = node.tagName.toLowerCase();
    if (SKIP_TAGS[tagName] || node.className.indexOf("notranslate") >= 0) {
        chunk.push("|");
        return;
    }
    if (tagName == "br" && this.doc.isPdf) {
        chunk.push("||");
        return;
    }
    var trAttr = node.getAttribute("translate");
    if (trAttr) {
        translationMode = (trAttr == "yes");  // MT-753
    }

    this.visitAttrs(node, translationMode);

    if (tagName == "textarea") {  // skip TEXTAREA, but translate 'placeholder' attr
        chunk.push("|");
        return;
    }

    var isDiv = !INLINE_TAGS[tagName], child;
    if (isDiv) {
        chunk.push("|");
        chunk = [];
    }

    for (child = node.firstChild; child; child = child.nextSibling) {
        this.visit(child, chunk, translationMode);
    }

    if (isDiv) {
        this.addChunk(chunk);
    }

    if (FRAME_TAGS[tagName] && translationMode) {
        this.visitFrame(node);
    }
};

Model.prototype.visitAttrs = function (node, translationMode) {
    if (!translationMode) {
        return;
    }

    if (this.dir) {
        node.style.direction = this.dir;
    }

    var lang = node.getAttribute("lang");
    if (lang == this.fromLang) {
        this.changedLangs.push(node);
        node.setAttribute("lang", this.toLang);
    }

    var tagName = node.tagName.toLowerCase();
    var textAttrs = [ "title" ], i, attr, attrName = TEXT_ATTRS[tagName];
    if (attrName) {
        textAttrs.push(attrName);
    }
    if (tagName == "input" && BUTTONS[node.type]) {
        textAttrs.push('value');
    }
    for (i = 0; i < textAttrs.length; ++i) {
        attr = node.getAttributeNode(textAttrs[i]);
        if (attr) {
            this.addChunk([attr]);
        }
    }
};

Model.prototype.visitFrame = function (node) {
    var frameSrc = node.getAttribute('src');
    // process only blank frames
    if ((!frameSrc || /\s*about:blank\s*/i.test(frameSrc)) && node.contentWindow) {
        try {
            // Attempt to translate dynamically created frame
            // with the same domain.
            this.visit(node.contentWindow.document.body, [], true);
        } catch (ignore) {
            // Skip exception quietly.
            // There is no appropriate ways to handle it yet.
        }
    }
};

function normalizeSpaces(node, str) {
    if (node.nodeType != Node.TEXT_NODE || node.parentNode.tagName.toLowerCase() == "pre") {
        return str;
    }
    return str.replace(/\s+/gm, ' ');
}

var TEXT_RANGES = [[0x41, 0x5b], [0x61, 0x7b], [0x100, 0xe000], [0xf900, 0xfffe]];

Model.hasText = function (str) {
    var i, j, r, code;
    for (i = 0; i < str.length; ++i) {
        code = str.charCodeAt(i);
        for (j = 0; j < TEXT_RANGES.length; ++j) {
            r = TEXT_RANGES[j];
            if (code < r[0]) {
                break;
            }
            if (code < r[1]) {
                return true;
            }
        }
    }
    return false;
};

Model.prototype.addChunk = function (chunk) {
    var i, j, n, start, nodes, node, span, str, textLen, isText, isDirty;
    if (this.doc.isPdf) {
        chunk = this.mergeSpans(chunk);
    }
    for (i = 0, n = chunk.length; i < n; ++i) {
        start = i;
        while (i < n && chunk[i] != '|') {
            ++i;
        }
        nodes = {
            spans: []
        };
        textLen = 0;
        isText = false;
        isDirty = false;
        for (j = start; j < i; ++j) {
            node = chunk[j];
            str = node.nodeValue;
            if (!str || /^\s+$/.test(str)) {
                continue;
            }
            str = normalizeSpaces(node, str);
            span = this.prev.findSpan(str, node);
            if (!span) {
                span = { node: node, text: str };
                isDirty = true;
            }
            nodes.spans.push(span);
            textLen += span.text.length;
            isText = isText || Model.hasText(span.text);
        }
        if (isText) {
            this.content.push(nodes);
            this.textLen += textLen;
            this.isDirty = this.isDirty || isDirty;
        }
    }
};

Model.prototype.mergeSpans = function (spans) {
    var chunk = [], i, span, lastSpan, nextSpan, text;
    for (i = 0; i < spans.length; ++i) {
        span = spans[i];
        if (span != '||') {
            chunk.push(span);
            continue;
        }
        lastSpan = chunk.pop();
        nextSpan = spans[++i];
        if (!lastSpan.nodes) {
            lastSpan = { nodeValue: lastSpan.nodeValue, nodes: [lastSpan] };
        }
        lastSpan.nodes.push(nextSpan);
        text = lastSpan.nodeValue;
        if (text.slice(-1) == '-') {
            text = text.slice(0, -1);
        } else {
            text += ' ';
        }
        lastSpan.nodeValue = text + nextSpan.nodeValue;
        chunk.push(lastSpan);
    }
    return chunk;
};

Model.prototype.breakChunks = function () {
    var chunks = this.content;
    var i, j, k, textLen, spans, prev, next, block, parent, blocks, blocksLen, docFragment;
    for (i = 0; i < chunks.length; ++i) {
        spans = chunks[i].spans;
        textLen = 0;
        for (j = 0; j < spans.length; ++j) {
            textLen += spans[j].text.length;
            if (textLen <= MAX_BLOCK_LEN) {
                continue;
            }
            if (j) {
                prev = {
                    spans: spans.splice(0, j)
                };
                chunks.splice(i, 0, prev);
                i += 1;
                j = -1;
                textLen = 0;
                continue;
            }
            if (spans.length > 1) {
                next = {
                    spans: spans.splice(1, spans.length - 1)
                };
                chunks.splice(i + 1, 0, next);
            }
            parent = spans[0];
            blocks = Breaker.breakText(parent.text, MAX_BLOCK_LEN);
            blocksLen = blocks.length;
            if (parent.node.nodeType === Node.TEXT_NODE && blocksLen > 1) {
                // split "fat" textNode to small pieces
                docFragment = document.createDocumentFragment();
                for (k = 0; k < blocksLen; ++k) {
                    block = blocks[k];
                    docFragment.appendChild(document.createTextNode(block));
                    blocks[k] = {
                        spans: [{
                            text: block,
                            node: docFragment.lastChild
                        }]
                    };
                }
                parent.node.parentNode.replaceChild(docFragment, parent.node);
                [].splice.apply(chunks, [i, 1].concat(blocks));
                i += blocksLen - 1;
            } else {
                parent.content = [];
                for (k = 0; k < blocksLen; ++k) {
                    parent.content[k] = {
                        spans: [{
                            node: {},
                            text: blocks[k]
                        }]
                    };
                }
            }
        }
    }
};

Model.prototype.setTranslation = function (obj, index, textArr) {
    var i, j, chunk, span, textLine, spans;
    for (i = 0; i < textArr.length; ++i) {
        chunk = obj.content[index++];
        spans = chunk.spans;
        textLine = textArr[i];
        chunk.tr = textLine.text.join('');
        chunk.text = '';
        chunk.align = Model.parseAlign(textLine.align);
        for (j = 0; j < spans.length; ++j) {
            span = spans[j];
            span.tr = textLine.text[j];
            chunk.text += span.text;
            Model.setNodeValue(span.node, span.tr);
        }
        this.trTextLen += chunk.text.length;
    }
    if (obj.node && obj.index >= obj.content.length) {  // finished translation of split chunk
        obj.tr = "";
        for (i = 0; i < obj.content.length; ++i) {
            chunk = obj.content[i];
            spans = chunk.spans;
            for (j = 0; j < spans.length; ++j) {
                obj.tr += spans[j].node.nodeValue;
            }
        }
        Model.setNodeValue(obj.node, obj.tr);
    }
};

Model.prototype.skipTranslated = function (chunk) {
    this.trTextLen += getChunkLen(chunk);
};

namespace.Doc = Doc;

}(window));
