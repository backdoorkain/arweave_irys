const express = require('express');
const multer = require('multer');
const Irys = require('@irys/sdk').default;
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

// Inicializar la conexión de la instancia unificada de Irys apuntando a Arweave Mainnet
let irysInstance;
let walletAddress = "";

try {
    if (process.env.ARWEAVE_WALLET) {
        const wallet = JSON.parse(process.env.ARWEAVE_WALLET);
        
        // Instancia unificada oficial para producción
        irysInstance = new Irys({
            url: "https://irys.xyz",
            token: "arweave",
            key: wallet,
        });

        // Obtener la dirección pública para la consulta GraphQL posterior
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

// --- RUTA 1: SUBIR ARCHIVO MEDIANTE BUNDLES (OPTIMIZADO) ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo.' });
        if (!irysInstance) return res.status(500).json({ error: 'Infraestructura Irys no lista.' });

        const fileData = fs.readFileSync(path.resolve(req.file.path));
        const dataBuffer = Buffer.from(fileData);

        // Etiquetas (Tags) para indexar en la red de Arweave
        const tags = [
            { name: 'Content-Type', value: req.file.mimetype },
            { name: 'App-Name', value: 'MiArweaveIrysUploader' },
            { name: 'File-Name', value: req.file.originalname }
        ];

        // Subida empaquetada instantánea (Gratis si pesa menos de 100 KB)
        const receipt = await irysInstance.upload(dataBuffer, { tags });

        // Limpieza obligatoria del almacenamiento temporal en Render
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

// --- RUTA 2: LISTAR ARCHIVOS (GraphQL adaptado a Irys) ---
app.get('/api/files', async (req, res) => {
    try {
        if (!walletAddress) return res.status(500).json({ error: 'Dirección de billetera no lista.' });

        // GraphQL busca las transacciones hechas bajo la etiqueta de esta app de Irys
        const query = {
            query: `query {
              transactions(
                owners: ["${walletAddress}"]
                tags: { name: "App-Name", values: ["MiArweaveIrysUploader"] }
                first: 50
              ) {
                edges {
                  node {
                    id
                    tags { name value }
                  }
                }
              }
            }`
        };

        // Irys comparte la misma infraestructura de gateways de Arweave
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
                url: `https://arweave.net{edge.node.id}` // Descarga directa tradicional
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
