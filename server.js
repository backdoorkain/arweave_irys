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

// --- SOLUCIÓN CRÍTICA: Forzamos la entrega directa del archivo index.html ---
// Ponemos la ruta estática '/' antes que express.static para saltarnos cualquier cacheo del servidor
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// El resto de recursos (si existieran imágenes o css locales) se sirven desde public
app.use(express.static(path.join(__dirname, 'public')));

// --- RUTA 5: RETIRAR FONDOS DE IRYS DE VUELTA A ARWEAVE NATIVO (NUEVO) ---
app.post('/api/withdraw', async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Monto inválido para retirar.' });
        }
        if (!irysInstance) {
            return res.status(500).json({ error: 'Instancia Irys no inicializada.' });
        }

        // 1. Convertir el monto ingresado en AR a la unidad mínima atómica (Winston)
        const atomicAmount = irysInstance.utils.toAtomic(amount);

        console.log(`>>> Solicitando retiro automático de ${amount} AR (${atomicAmount} Winston) hacia tu wallet...`);

        // 2. Ejecutar la orden de retiro directo en los servidores de Irys
        const withdrawResult = await irysInstance.withdraw(atomicAmount);

        return res.json({
            success: true,
            message: `Retiro procesado por el nodo con éxito.`,
            txId: withdrawResult.id || 'N/A'
        });
    } catch (error) {
        console.error("Fallo al retirar desde el nodo de Irys:", error);
        return res.status(500).json({ error: `Error en la orden de retiro: ${error.message}` });
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

// --- RUTA 4: FONDEAR DESDE LA BILLETERA INTERNA ---
app.post('/api/fund', async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Monto inválido para depositar.' });
        }
        if (!irysInstance) return res.status(500).json({ error: 'Instancia Irys no inicializada.' });

        const atomicAmount = irysInstance.utils.toAtomic(amount);
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

app.listen(PORT, () => {
    console.log(`Servidor de Irys corriendo en el puerto ${PORT}`);
});
