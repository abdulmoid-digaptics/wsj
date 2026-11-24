/** Side-effect module: applies dashboard-managed settings before any other module reads process.env. */
import {applyVaultToEnv} from './settings-vault';
applyVaultToEnv();
