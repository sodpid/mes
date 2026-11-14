// Native backup/restore proof for one explicitly frozen local fixture; never accepts a production target.
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {parse} from 'dotenv';
import {connect,guard,operate,secretWrite,collectSchema,canonical,canonicalDDL} from '../deploy/bigint-data.mjs';
const target='mes_test_bigint_1792834758993_target';
const envPath='artifacts/bigint-data-1792834758993/target.env';
const container='mes-mysql-local-mysql-1';
const stamp=String(Date.now()),restore='mes_test_bigint_'+stamp+'_restore';
const account='mes_native_backup_'+stamp;
const password=randomBytes(24).toString('hex');
const artifact='artifacts/bigint-native-backup-'+stamp;
const rootFile='/tmp/mes-native-restore-'+stamp+'.cnf';
const backupCnf=artifact+'/backup.cnf';
const dumpFile=artifact+'/native.sql.gz';
let admin,source,restored,userCreated=false,databaseCreated=false,rootSecretCreated=false;
const evidence={at:new Date().toISOString(),source:target,restore,sourceFrozenByImplementationOwner:true,productionTouched:false,assertions:[],allPassed:false};
function check(value,label){if(!value)throw Error(label);evidence.assertions.push(label);}
function child(args,input){return new Promise((resolve,reject)=>{const c=spawn('docker',args,{stdio:['pipe','pipe','pipe'],windowsHide:true});const output=[];let errors='';c.stdout.on('data',x=>output.push(x));c.stderr.on('data',x=>{errors+=x.toString();});c.on('error',()=>reject(Error('Docker process unavailable')));c.on('close',code=>code===0?resolve(Buffer.concat(output)):reject(Error('Docker command failed (exit '+code+'); protected stderr omitted')));c.stdin.on('error',()=>{});if(input&&typeof input.pipe==='function')input.pipe(c.stdin);else c.stdin.end(input);});}
async function restrictedText(path,value){const f=await fs.open(path,'wx',0o600);try{await f.writeFile(value);await f.sync();}finally{await f.close();}await fs.chmod(path,0o600);}
async function dump(){const childProcess=spawn('docker',['exec','-i',container,'mysqldump','--defaults-extra-file=/dev/stdin','--single-transaction','--no-tablespaces','--set-gtid-purged=OFF','--triggers','--events',target],{stdio:['pipe','pipe','pipe'],windowsHide:true});let error='';childProcess.stderr.on('data',x=>{error+=x.toString();});const ended=new Promise((resolve,reject)=>{childProcess.on('error',()=>reject(Error('Dump process unavailable')));childProcess.on('close',code=>code===0?resolve():reject(Error('Minimum-privilege mysqldump failed (exit '+code+'); protected stderr omitted')));});childProcess.stdin.on('error',()=>{});createReadStream(backupCnf).pipe(childProcess.stdin);const streamed=pipeline(childProcess.stdout,createGzip(),createWriteStream(dumpFile,{flags:'wx',mode:0o600}));await Promise.all([ended,streamed]);await fs.chmod(dumpFile,0o600);check((await fs.stat(dumpFile)).size>0,'最小权限原生mysqldump生成非空gzip备份');}
try{
 const env=parse(await fs.readFile(envPath,'utf8'));const url=new URL(env.DATABASE_URL);process.env.MES_RESTORE_VERIFICATION='1';guard(url,target);check(url.hostname==='127.0.0.1'&&url.port==='13379'&&url.pathname==='/'+target,'固定loopback13379及已冻结测试target');
 const ports=JSON.parse((await child(['inspect','--format','{{json .NetworkSettings.Ports}}',container])).toString());check(ports['3306/tcp']?.some(p=>p.HostIp==='127.0.0.1'&&p.HostPort==='13379'),'Docker容器端口精确匹配专属本地MySQL');
 await fs.mkdir(artifact,{recursive:false,mode:0o700});source=await connect(url);const adminUrl=new URL(url);adminUrl.pathname='/';admin=await connect(adminUrl);const version=(await source.query('SELECT VERSION() version'))[0][0].version;check(version==='8.4.11','MySQL8.4.11');
 const ddl=(await source.query('SHOW CREATE TABLE users'))[0][0]['Create Table'];const explicit=ddl.replace('`password_hash` text COLLATE','`password_hash` text CHARACTER SET utf8mb4 COLLATE');check(explicit!==ddl&&canonicalDDL(explicit)===canonicalDDL(ddl),'仅列声明冗余utf8mb4显式写法规范后相等');const changedCollation=explicit.replace('`password_hash` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin','`password_hash` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');check(canonicalDDL(changedCollation)!==canonicalDDL(ddl),'改变列collation仍拒绝');const changedCheck=ddl.replace('`active` in (0,1)','`active` in (0,2)');check(canonicalDDL(changedCheck)!==canonicalDDL(ddl),'改变CHECK内容仍拒绝');const changedIndex=ddl.replace('  PRIMARY KEY (`id`),','  KEY `forbidden_uuid` (`uuid`),\n  PRIMARY KEY (`id`),');check(canonicalDDL(changedIndex)!==canonicalDDL(ddl),'新增UUID索引仍拒绝');const changedAscii=ddl.replace('CHARACTER SET ascii COLLATE ascii_bin','CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');check(canonicalDDL(changedAscii)!==canonicalDDL(ddl),'改变ASCII标识字符集仍拒绝');const defaultLiteral="  `note` varchar(100) COLLATE utf8mb4_0900_bin DEFAULT ' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin',";check(canonicalDDL(defaultLiteral)===defaultLiteral,'DEFAULT文本字面量不被规范化改写');
 const snapshot=await operate(source,'export');await secretWrite(artifact+'/before.json',snapshot);
 await admin.query('CREATE DATABASE `'+restore+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin');databaseCreated=true;
 await admin.query("CREATE USER ?@'localhost' IDENTIFIED BY ?",[account,password]);userCreated=true;await admin.query("GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON `"+target+"`.* TO ?@'localhost'",[account]);
 const grants=(await admin.query("SHOW GRANTS FOR ?@'localhost'",[account]))[0].map(r=>Object.values(r)[0]);check(grants.length===2&&grants.some(x=>/^GRANT USAGE ON \*\.\*/.test(x))&&grants.some(x=>x.includes('SELECT, SHOW VIEW, EVENT, TRIGGER')||x.includes('SELECT, SHOW VIEW, TRIGGER, EVENT'))&&!grants.some(x=>/ALL PRIVILEGES|PROCESS|RELOAD|LOCK TABLES|INSERT|UPDATE|DELETE|CREATE|DROP|GRANT OPTION/.test(x)),'备份账号仅USAGE和目标库SELECT/SHOW VIEW/TRIGGER/EVENT，不含PROCESS或表DML权限');
 await restrictedText(backupCnf,'[client]\nuser='+account+'\npassword='+password+'\n');
 const current=(await child(['exec','-i',container,'mysql','--defaults-extra-file=/dev/stdin','--batch','--skip-column-names','--execute','SELECT CURRENT_USER()'],createReadStream(backupCnf))).toString().trim();check(current===account+'@localhost','实际备份客户端身份为临时最小权限账号');
 await dump();
 const rootConfig='[client]\nuser='+decodeURIComponent(url.username)+'\npassword='+decodeURIComponent(url.password)+'\n';await child(['exec','-i',container,'sh','-c','umask 077; cat > "$1"; chmod 600 "$1"','sh',rootFile],rootConfig);rootSecretCreated=true;
 const restoreClient=spawn('docker',['exec','-i',container,'mysql','--defaults-extra-file='+rootFile,'--binary-mode','--database='+restore],{stdio:['pipe','pipe','pipe'],windowsHide:true});restoreClient.stdout.resume();restoreClient.stderr.resume();const restoreEnded=new Promise((resolve,reject)=>{restoreClient.on('error',()=>reject(Error('Restore client unavailable')));restoreClient.on('close',code=>code===0?resolve():reject(Error('Native SQL restore failed (exit '+code+')')));});restoreClient.stdin.on('error',()=>{});await Promise.all([pipeline(createReadStream(dumpFile),createGunzip(),restoreClient.stdin),restoreEnded]);check(true,'gzip完整解压并原生SQL恢复至自有新库成功');
 const restoreUrl=new URL(url);restoreUrl.pathname='/'+restore;guard(restoreUrl,restore);restored=await connect(restoreUrl);const actualSchema=await collectSchema(restored);const differences=[];for(const name of Object.keys(snapshot.schema))if(JSON.stringify(snapshot.schema[name])!==JSON.stringify(actualSchema[name]))differences.push({table:name,expected:snapshot.schema[name],actual:actualSchema[name],sourceDDL:(await source.query('SHOW CREATE TABLE '+name))[0][0]['Create Table'],restoredDDL:(await restored.query('SHOW CREATE TABLE '+name))[0][0]['Create Table']});await secretWrite(artifact+'/schema-diff.json',differences);const report=await operate(restored,'verify',structuredClone(snapshot));await secretWrite(artifact+'/verification.json',report);check(report.allEqual,'原生恢复后25表全新字段摘要/结构/外键与源快照一致');
 const after=await operate(source,'export');check(JSON.stringify(after.tables)===JSON.stringify(snapshot.tables)&&JSON.stringify(canonical(after.autoIncrement))===JSON.stringify(canonical(snapshot.autoIncrement)),'源target全部字段及AUTO_INCREMENT保持不变');
 const restoredSnapshot=await operate(restored,'export');check(JSON.stringify(canonical(restoredSnapshot.autoIncrement))===JSON.stringify(canonical(snapshot.autoIncrement)),'17实体AUTO_INCREMENT next字符串完全相等（含大于2^53值）');evidence.tables=report.tables.length;evidence.rows=report.totalRows;evidence.allPassed=true;
}catch(error){evidence.failure=error.code||error.message;throw Error('Native backup test failed: '+evidence.failure);}finally{
 const cleanupFailures=[];
 if(restored)try{await restored.end();}catch{cleanupFailures.push('restore connection');}
 if(rootSecretCreated)try{await child(['exec',container,'rm','--',rootFile]);}catch{cleanupFailures.push('container credential file');}
 if(userCreated)try{await admin.query("DROP USER ?@'localhost'",[account]);}catch{cleanupFailures.push('temporary backup account');}
 if(databaseCreated)try{if(!/^mes_test_bigint_[0-9]+_restore$/.test(restore)||restore===target)throw Error('Unsafe cleanup target');await admin.query('DROP DATABASE `'+restore+'`');}catch{cleanupFailures.push('own restore database');}
 try{await fs.rm(backupCnf,{force:true});}catch{cleanupFailures.push('local credential file');}
 if(source)try{await source.end();}catch{cleanupFailures.push('source connection');}
 if(admin)try{await admin.end();}catch{cleanupFailures.push('admin connection');}
 evidence.cleanup={sourcePreserved:true,ownRestoreDropped:databaseCreated&&!cleanupFailures.includes('own restore database'),temporaryAccountDropped:userCreated&&!cleanupFailures.includes('temporary backup account'),secretFilesRemoved:!cleanupFailures.includes('container credential file')&&!cleanupFailures.includes('local credential file'),failures:cleanupFailures};
 await fs.mkdir(artifact,{recursive:true,mode:0o700});await secretWrite(artifact+'/evidence.json',evidence);if(cleanupFailures.length)throw Error('Cleanup incomplete: '+cleanupFailures.join(','));if(evidence.allPassed)console.log(JSON.stringify({evidence:artifact+'/evidence.json',allPassed:true,tables:evidence.tables,rows:evidence.rows,sourcePreserved:true,cleanupComplete:true}));
}



