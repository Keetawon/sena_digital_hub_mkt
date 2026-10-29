import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function apiTestArguments(extra,root=fileURLToPath(new URL('../',import.meta.url))) {
  const tests=path.resolve(root,'apps/api/tests'),args=[];
  // Separate option operands (especially -k expressions) are not test selectors.
  const valueOptions=new Set(['-k','-m','-o','--override-ini','-p','-c','--config-file','-W','--pythonwarnings',
    '--maxfail','--durations','--durations-min','--tb','--capture','--color','--code-highlight','--verbosity',
    '--rootdir','--basetemp','--confcutdir','--ignore','--ignore-glob','--deselect','--import-mode','--assert',
    '--junitxml','--junit-xml','--junitprefix','--junit-prefix','--log-level','--log-format','--log-date-format',
    '--log-cli-level','--log-cli-format','--log-cli-date-format','--log-file','--log-file-level','--log-file-format','--log-file-date-format']);
  let selected=false,operand=false,positionalOnly=false;
  for(const arg of extra){
    if(operand){args.push(arg);operand=false;continue;}
    if(!positionalOnly&&arg.startsWith('-')){args.push(arg);operand=valueOptions.has(arg);if(arg==='--')positionalOnly=true;continue;}
    const split=arg.indexOf('::'),file=split<0?arg:arg.slice(0,split),node=split<0?'':arg.slice(split);
    const resolved=path.resolve(root,file),relative=path.relative(tests,resolved);
    if(!file||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))
      throw new Error('API test path is outside apps/api/tests; refused before database setup.');
    args.push(resolved+node);selected=true;
  }
  return selected?args:[tests,...args];
}
