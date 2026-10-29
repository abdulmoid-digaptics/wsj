'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
export default function RichEditor({value,onChange}: {value: string; onChange: (html:string)=>void}) {
 const editor = useEditor({extensions:[StarterKit.configure({link:false}), Link.configure({openOnClick:false})], content:value, immediatelyRender:false, onUpdate:({editor})=>onChange(editor.getHTML()), editorProps:{attributes:{class:'adm-prose','aria-label':'Article content'}}});
 if(!editor) return <div className="adm-loading">Loading editor…</div>;
 return <div className="adm-editor"><div className="adm-editor-tools">
 <button type="button" aria-label="Bold" aria-pressed={editor.isActive('bold')} onClick={()=>editor.chain().focus().toggleBold().run()}><b>B</b></button>
 <button type="button" aria-label="Italic" aria-pressed={editor.isActive('italic')} onClick={()=>editor.chain().focus().toggleItalic().run()}><i>I</i></button>
 <button type="button" aria-pressed={editor.isActive('heading',{level:2})} onClick={()=>editor.chain().focus().toggleHeading({level:2}).run()}>Heading</button>
 <button type="button" aria-pressed={editor.isActive('bulletList')} onClick={()=>editor.chain().focus().toggleBulletList().run()}>Bullets</button>
 <button type="button" onClick={()=>editor.chain().focus().toggleOrderedList().run()}>Numbered</button>
 <button type="button" onClick={()=>editor.chain().focus().toggleBlockquote().run()}>Quote</button>
 <button type="button" onClick={()=>{const url=window.prompt('Link URL (https://…)'); if(url===null)return; if(!url){editor.chain().focus().unsetLink().run();return;} if(!/^(https?:\/\/|mailto:)/i.test(url)){window.alert('Use an http, https or mailto link.');return;}editor.chain().focus().setLink({href:url}).run();}}>Link</button>
 <button type="button" onClick={()=>editor.chain().focus().undo().run()}>Undo</button><button type="button" onClick={()=>editor.chain().focus().redo().run()}>Redo</button></div><EditorContent editor={editor}/></div>;
}
