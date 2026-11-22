// Tiny stack VM: implements ISA.md exactly (32-bit wrap, traps 2-11,
// step limit 1,000,000, output limit 65,536, check order per step).
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
function run(p,inp){
 let pc=0,steps=0,ip=0;
 const s=[],c=[],m=new Int32Array(256),o=[];
 const ck=(a,b)=>{if(s.length<a)throw 2;if(s.length-a+b>256)throw 3;};
 try{
  for(;;){
   if(steps>=1000000)throw 10;
   if(pc<0||pc>=p.length)throw 9;
   const op=p[pc];
   const known=op<=7||(op>=16&&op<=34)||(op>=48&&op<=52)||op===64||op===65||(op>=80&&op<=83);
   if(!known)throw 5;
   const il=op===1?1:op===2?4:(op>=48&&op<=51)?2:0;
   if(pc+1+il>p.length)throw 9;
   steps++;
   const nx=pc+1+il;
   let a,b,v,r;
   if(op===0)return{o:Buffer.from(o),e:0};
   if(op===1){ck(0,1);v=p[pc+1];s.push(v>127?v-256:v);pc=nx;}
   else if(op===2){ck(0,1);s.push(p[pc+1]|p[pc+2]<<8|p[pc+3]<<16|p[pc+4]<<24);pc=nx;}
   else if(op===3){ck(1,0);s.pop();pc=nx;}
   else if(op===4){ck(1,2);s.push(s[s.length-1]);pc=nx;}
   else if(op===5){ck(2,2);b=s.pop();a=s.pop();s.push(b,a);pc=nx;}
   else if(op===6){ck(2,3);b=s.pop();a=s.pop();s.push(a,b,a);pc=nx;}
   else if(op===7){ck(3,3);v=s.pop();b=s.pop();a=s.pop();s.push(b,v,a);pc=nx;}
   else if(op>=16&&op<=34){
    if(op===23||op===27){ck(1,1);a=s.pop();s.push(op===23?(-a)|0:~a);}
    else{ck(2,1);b=s.pop();a=s.pop();
     switch(op){
      case 16:r=(a+b)|0;break;
      case 17:r=(a-b)|0;break;
      case 18:r=Math.imul(a,b);break;
      case 19:if(!b)throw 4;r=Math.trunc(a/b)|0;break;
      case 20:if(!b)throw 4;r=(a%b)|0;break;
      case 21:if(!b)throw 4;r=Math.floor((a>>>0)/(b>>>0))|0;break;
      case 22:if(!b)throw 4;r=((a>>>0)%(b>>>0))|0;break;
      case 24:r=a&b;break;
      case 25:r=a|b;break;
      case 26:r=a^b;break;
      case 28:r=a<<(b&31);break;
      case 29:r=a>>(b&31);break;
      case 30:r=(a>>>(b&31))|0;break;
      case 32:r=a===b?1:0;break;
      case 33:r=a<b?1:0;break;
      default:r=(a>>>0)<(b>>>0)?1:0;
     }
     s.push(r);
    }
    pc=nx;
   }
   else if(op>=48&&op<=51){
    let off=p[pc+1]|p[pc+2]<<8;
    if(op!==51&&off>32767)off-=65536;
    if(op===48)pc=nx+off;
    else if(op===51){if(c.length>=64)throw 7;c.push(nx);pc=off;}
    else{ck(1,0);v=s.pop();pc=((op===49&&v===0)||(op===50&&v!==0))?nx+off:nx;}
   }
   else if(op===52){if(!c.length)throw 8;pc=c.pop();}
   else if(op===64){ck(1,1);a=s.pop();if(a<0||a>255)throw 6;s.push(m[a]);pc=nx;}
   else if(op===65){ck(2,0);a=s.pop();v=s.pop();if(a<0||a>255)throw 6;m[a]=v;pc=nx;}
   else if(op===80){ck(1,0);v=s.pop();const t=String(v);if(o.length+t.length>65536)throw 11;for(const ch of t)o.push(ch.charCodeAt(0));pc=nx;}
   else if(op===81){ck(1,0);v=s.pop();if(o.length>=65536)throw 11;o.push(v&255);pc=nx;}
   else if(op===82){ck(0,1);s.push(ip<inp.length?inp[ip++]:-1);pc=nx;}
   else{ck(1,0);v=s.pop();return{o:Buffer.from(o),e:v&255};}
  }
 }catch(e){return{o:Buffer.from(o),e:typeof e==='number'?e:9};}
}
const I=process.env.MAKEFUN_INPUT_DIR??'/input';
const O=process.env.MAKEFUN_OUTPUT_DIR??'/output';
for(const id of readdirSync(I).sort()){
 const d=join(I,id);
 const r=run(readFileSync(join(d,'program.bin')),existsSync(join(d,'input.bin'))?readFileSync(join(d,'input.bin')):Buffer.alloc(0));
 mkdirSync(join(O,id),{recursive:true});
 writeFileSync(join(O,id,'stdout.bin'),r.o);
 writeFileSync(join(O,id,'exit.txt'),r.e+'\n');
}
