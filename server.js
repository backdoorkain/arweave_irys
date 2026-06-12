const express = require('express');
const multer = require('multer');
const Irys = require('@irys/sdk').default;
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

// Inicializar variables globales
let irysInstance;
let walletAddress = "";

// 1. Envolver la inicialización de Irys en una función asíncrona dedicada
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
            console.log(`>>> Conectado exitosamente a Irys Mainnet. Dirección: ${walletAddress}`);
        } else {
            console.error(">>> ERROR DE SEGURIDAD: Falta definir la variable ARWEAVE_WALLET.");
        }
    } catch (error) {
        console.error(">>> ERROR al inicializar Irys:", error.message);
    }
}

// Ejecutar la inicialización segura de inmediato
inicializarIrys();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- RUTA 4: FONDEAR DESDE LA BILLETERA INTERNA (NUEVO) ---
app.post('/api/fund', async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Monto inválido para depositar.' });
        }
        if (!irysInstance) {
            return res.status(500).json({ error: 'Instancia Irys no inicializada.' });
        }

        // 1. Convertir el monto flotante de AR a la unidad mínima atómica (Winston)
        const atomicAmount = irysInstance.utils.toAtomic(amount);

        console.log(`>>> Solicitando fondeo automático de ${amount} AR (${atomicAmount} Winston)...`);

        // 2. Ejecutar el fondeo directo a nivel de servidor utilizando tu wallet.json real
        const fundResult = await irysInstance.fund(atomicAmount);

        return res.json({
            success: true,
            message: `Fondeo enviado a la red con éxito.`,
            txId: fundResult.id
        });
    } catch (error) {
        console.error("Fallo al fondear desde billetera interna:", error);
        return res.status(500).json({ error: `Error en la transacción de fondeo: ${error.message}` });
    }
});

// --- RUTA 2: LISTAR ARCHIVOS (GraphQL) ---
app.get('/api/files', async (req, res) => {
    try {
        if (!walletAddress) return res.status(500).json({ error: 'Dirección de billetera no lista.' });

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

        // CORRECCIÓN CLAVE: El endpoint maneja el await correctamente dentro del contexto 'async' de la ruta Express
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
        console.error("Fallo en GraphQL:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- RUTA 3: CONSULTAR SALDO ACTUAL EN EL NODO DE IRYS ---
app.get('/api/balance', async (req, res) => {
    try {
        if (!irysInstance) return res.status(500).json({ error: 'Instancia Irys no inicializada.' });
        
        const atomicBalance = await irysInstance.getLoadedBalance();
        const arBalance = irysInstance.utils.fromAtomic(atomicBalance).toString();
        
        res.json({ success: true, balance: arBalance });
    } catch (error) {
        console.error("Error al consultar saldo:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor de Irys corriendo en el puerto ${PORT}`);
});
