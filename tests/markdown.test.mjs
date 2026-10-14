import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import {remarkPlugins,rehypePlugins} from '../app/remark-callouts.mjs';
const render=(text)=>renderToStaticMarkup(React.createElement(ReactMarkdown,{skipHtml:true,remarkPlugins,rehypePlugins},text));
test('Named info containers become collapsed native details with an editable title',()=>{
 const html=render('Before\n\n:::info[code]\n\n**Explanation**\n\n```cpp\ncout<<1;\n```\n\n:::\n\nAfter');
 assert.match(html,/<details class="md-callout md-callout-info">/);
 assert.match(html,/<summary class="md-callout-summary">code<\/summary>/);
 assert.match(html,/<strong>Explanation<\/strong>/);
 assert.match(html,/class="language-cpp"/);
 assert.match(html,/cout&lt;&lt;1;/);
 assert.match(html,/<p>Before<\/p>/);
 assert.match(html,/<p>After<\/p>/);
 assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
});
test('Inner Markdown retains formulas, tables and list formatting, and supports nested containers',()=>{
 const html=render('::::info[outer]\n\n$1+1=2$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- item\n\n:::tip[inner]\n\nNested **body**.\n\n:::\n\n::::');
 assert.match(html,/class="katex"/);
 assert.match(html,/<table>/);
 assert.match(html,/<li>item<\/li>/);
 assert.match(html,/md-callout-tip/);
 assert.match(html,/<strong>body<\/strong>/);
 assert.equal((html.match(/<details /g)||[]).length,2);
});
test('Untitled containers get a useful title, optional open works, and syntax inside code is literal',()=>{
 assert.match(render(':::info\n\nbody\n\n:::'),/>提示<\/summary>/);
 assert.match(render(':::info[opened]{open}\n\nbody\n\n:::'),/<details[^>]*open=""/);
 const html=render('```markdown\n:::info[code]\ntext\n:::\n```');
 assert.doesNotMatch(html,/<details/);
 assert.match(html,/:::info\[code\]/);
});
test('Directive attributes and raw HTML do not gain script or HTML execution',()=>{
 const html=render(':::info[title]{onclick="alert(1)" style="color:red"}\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n:::');
 assert.doesNotMatch(html,/<script|onclick=|style="color:red"|href="javascript:/);
 assert.match(html,/md-callout-info/);
});
