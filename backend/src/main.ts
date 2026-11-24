import 'dotenv/config';
// Must run before application imports: some modules read configuration when first loaded.
import './settings-bootstrap';
import {createApplication} from './application';
async function main(){const app=await createApplication();await app.listen(Number(process.env.PORT||4000),process.env.HOST||'0.0.0.0');}
main().catch(e=>{console.error(e.message);process.exit(1);});
