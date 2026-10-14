import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
const bundled = await build({ entryPoints: ["src/lib/libraryArticles.js"], bundle: true, write: false, format: "esm", platform: "node", plugins: [{name:"mock-cloud",setup(b){b.onResolve({filter:/supabaseClient/},()=>({path:"cloud",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"export const supabase=null;"}));}}] });
const { validateLibraryArticle } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
test("manual articles validate text and safe links without fetching a website",()=>{
 const valid={source_url:"https://example.com/read",title:" Read ",body_en:"First.\n\nSecond."};
 assert.equal(validateLibraryArticle(valid).title,"Read");
 assert.deepEqual(validateLibraryArticle(valid).analysis,{});
 for(const changes of [{source_url:"javascript:alert(1)"},{title:""},{body_en:" "},{analysis:[]},{analysis:null},{body_en:"x".repeat(50001)}]) assert.throws(()=>validateLibraryArticle({...valid,...changes}));
});
test("library article RLS restricts all browser CRUD to its owner",()=>{
 const sql=readFileSync("supabase/migrations/20261015000000_library_articles.sql","utf8");
 assert.match(sql,/enable row level security/);
 assert.match(sql,/using \(auth.uid\(\) = user_id\) with check \(auth.uid\(\) = user_id\)/);
 assert.match(sql,/revoke all.*from anon/);
});
