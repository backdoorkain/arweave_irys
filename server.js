const express = require('express');
const multer = require('multer');
const Irys = require('@irys/sdk').default;
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

let irysInstance;
let walletAddress = "";

async function inicializarIrys() {
    try {
        if (process.env.ARWEAVE_WALLET) {
            const wallet = JSON.parse(process.env.ARWEAVE_WALLET);
            
            irysInstance = new Irys({
                network: "mainnet",
                token: "arweave",
                key: wallet,
            });

            walletAddress = irysInstance.address;
            console.log(`>>> Conectado a Irys Mainnet. Dirección: ${walletAddress}`);
        } else {
            console.error(">>> ERROR DE SEGURIDAD: Falta definir la variable ARWEAVE_WALLET.");
        }
    } catch (error) {
        console.error(">>> ERROR al inicializar Irys:", error.message);
    }
}

inicializarIrys();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// --- RUTA 1: SUBIR ARCHIVO MEDIANTE BUNDLES ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo.' });
        if (!irysInstance) return res.status(500).json({ error: 'Infraestructura Irys no lista.' });

        const fileData = fs.readFileSync(path.resolve(req.file.path));
        const dataBuffer = Buffer.from(fileData);

        const tags = [
            { name: 'Content-Type', value: req.file.mimetype },
            { name: 'App-Name', value: 'MiArweaveIrysUploader' },
            { name: 'File-Name', value: req.file.originalname }
        ];

        const receipt = await irysInstance.upload(dataBuffer, { tags });

        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        return res.json({ success: true, txId: receipt.id });
    } catch (error) {
        console.error(error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: error.message });
    }
});

// --- RUTA 2: LISTAR ARCHIVOS (GraphQL) ---
app.get('/api/files', async (req, res) => {
    try {
        if (!walletAddress) return res.status(500).json({ error: 'Billetera no lista.' });

        const query = {
            query: `query {
              transactions(
                owners: ["${walletAddress}"]
                tags: { name: "App-Name", values: ["MiArweaveIrysUploader"] }
                first: 50
              ) {
                edges { node { id tags { name value } } }
              }
            }`
        };

        const response = await irysInstance.api.post('/graphql', query);
        const edges = response.data.data.transactions.edges;

        const files = edges.map(edge => {
            const tags = edge.node.tags;
            const nameTag = tags.find(t => t.name === 'File-Name');
            const typeTag = tags.find(t => t.name === 'Content-Type');
            return {
                id: edge.node.id,
                name: nameTag ? nameTag.value : 'Archivo sin nombre',
                type: typeTag ? typeTag.value : 'Desconocido',
                url: `https://arweave.net{edge.node.id}`
            };
        });

        res.json({ success: true, files });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- RUTA 3: CONSULTAR SALDO ACTUAL ---
app.get('/api/balance', async (req, res) => {
    try {
        if (!irysInstance) return res.status(500).json({ error: 'Irys no inicializado.' });
        const atomicBalance = await irysInstance.getLoadedBalance();
        const arBalance = irysInstance.utils.fromAtomic(atomicBalance).toString();
        res.json({ success: true, balance: arBalance });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- RUTA 4: FONDEAR DESDE BILLETERA INTERNA ---
app.post('/api/fund', async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Monto inválido.' });
        
        const atomicAmount = irysInstance.utils.toAtomic(amount);
        const fundResult = await irysInstance.fund(atomicAmount);
        return res.json({ success: true, txId: fundResult.id });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// --- RUTA 5 CORREGIDA: RETIRAR FONDOS MEDIANTE EL METODO UPLOADER NATIVO ---
app.post('/api/withdraw', async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Monto inválido.' });
        if (!irysInstance) return res.status(500).json({ error: 'Irys no listo.' });

        const atomicAmount = irysInstance.utils.toAtomic(amount);

        console.log(`>>> Ejecutando orden de retiro por: ${amount} AR...`);

        // CORRECCIÓNTÉCNICA: Se invoca la función withdrawBalance desde la propiedad uploader
        const withdrawResult = await irysInstance.uploader.withdrawBalance(atomicAmount);

        return res.json({
            success: true,
            txId: withdrawResult.id || 'Confirmado por nodo'
        });
    } catch (error) {
        console.error("Error al retirar:", error);
        return res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor de Irys corriendo en el puerto ${PORT}`);
});
