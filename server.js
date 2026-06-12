const express = require('express');
const multer = require('multer');
const Irys = require('@irys/sdk').default;
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

// Inicializar la conexión unificada de Irys con la sintaxis moderna de Mainnet
let irysInstance;
let walletAddress = "";

try {
    if (process.env.ARWEAVE_WALLET) {
        const wallet = JSON.parse(process.env.ARWEAVE_WALLET);
        
        // CORRECCIÓN PRINCIPAL: Usamos 'network: "mainnet"' en lugar de la URL directa del nodo
        irysInstance = new Irys({
            network: "mainnet", // Configura automáticamente los endpoints correctos de producción
            token: "arweave",
            key: wallet,
        });

        walletAddress = irysInstance.address;
        console.log(`>>> Conectado exitosamente a Irys Mainnet. Dirección: ${walletAddress}`);
    } else {
        console.error(">>> ERROR DE SEGURIDAD: Falta definir la variable ARWEAVE_WALLET.");
    }
} catch (error) {
    console.error(">>> ERROR al inicializar Irys:", error.message);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

        // Ejecutar subida empaquetada (Gratis si pesa menos de 100 KB)
        const receipt = await irysInstance.upload(dataBuffer, { tags });

        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        return res.json({
            success: true,
            txId: receipt.id,
            message: "¡Archivo subido e indexado de forma instantánea!"
        });

    } catch (error) {
        console.error("Fallo en subida Irys:", error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(500).json({ error: `Error en la red Irys: ${error.message}` });
    }
});

// --- RUTA 2: LISTAR ARCHIVOS (GraphQL) ---
app.get('/api/balance', async (req, res) => {
    try {
        if (!irysInstance) return res.status(500).json({ error: 'Instancia Irys no inicializada.' });
        
        // Obtener el saldo en la unidad mínima (Winston)
        const atomicBalance = await irysInstance.getLoadedBalance();
        
        // Convertirlo a formato legible de AR tokens usando el SDK interno
        const arBalance = irysInstance.utils.fromAtomic(atomicBalance).toString();
        
        res.json({ success: true, balance: arBalance });
    } catch (error) {
        console.error("Error al consultar saldo:", error);
        res.status(500).json({ error: error.message });
    }
});

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
                url: `https://arweave.net/${edge.node.id}`
            };
        });

        res.json({ success: true, files });
    } catch (error) {
        console.error("Fallo en GraphQL:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor de Irys corriendo en el puerto ${PORT}`);
});
