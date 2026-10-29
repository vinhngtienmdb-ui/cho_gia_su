import { readApiConfiguration } from './common/configuration.js';
import { createApplication } from './create-application.js';

// Máy chủ API của Chợ gia sư
const configuration = readApiConfiguration();
const application = await createApplication(configuration);
await application.listen(configuration.port);
console.log(`Máy chủ API Chợ gia sư chạy ở cổng ${configuration.port}`);
