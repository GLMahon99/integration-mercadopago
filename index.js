import express, { json } from "express";
import cors from "cors";
import mysql from 'mysql2';
import util from 'util';
import dotenv from 'dotenv';
import { MercadoPagoConfig, Preference } from "mercadopago";

const client = new MercadoPagoConfig({
  accessToken: "APP_USR-6794150768740601-102714-e046b0986d62551114608a1535d5693e-130952820",
});

const app = express();
const port = 8000;

dotenv.config();

console.log("Variables de entorno:");
console.log("MYSQLHOST:", process.env.MYSQLHOST);
console.log("MYSQLPORT:", process.env.MYSQLPORT);
console.log("MYSQLUSER:", process.env.MYSQLUSER);
console.log("MYSQLPASSWORD:", process.env.MYSQLPASSWORD);
console.log("MYSQLDATABASE:", process.env.MYSQLDATABASE);


const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: Number(process.env.MYSQLPORT),
  ssl: { rejectUnauthorized: false }
});


pool.query = util.promisify(pool.query);

pool.getConnection((err, connection) => {
  if (err) {
    console.error("No se pudo conectar a la base de datos:", err);
  } else {
    console.log("Conexión a la base de datos establecida correctamente");
    connection.release();
  }
});


app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("soy el server");
});

app.post("/create_preference", async (req, res) => {
  try {
    console.log("Datos recibidos en el backend:", req.body);

    const { items, customerData, clientData, cart } = req.body;

    if (!items || !Array.isArray(items)) {
      throw new Error("Items no válidos o faltantes");
    }

    // Validar items
    const validatedItems = items.map((item) => {
      if (!item.unit_price) {
        throw new Error("unit_price needed");
      }
      return {
        title: item.title,
        quantity: item.quantity,
        unit_price: item.unit_price,
        currency_id: "ARS",
      };
    });

    const body = {
      items: validatedItems,
      back_urls: {
        success: "https://www.earplugs.com.ar",
        failure: "https://www.tusitio.com/failure",
        pending: "https://www.tusitio.com/pending",
      },
      auto_return: "approved",
    };

    // Buscar usuario por número de identificación
    const { number_id } = clientData;
    const queryFindUser = "SELECT id FROM usuarios WHERE numero_identificacion = ?";

    // Convertir cart a JSON y preparar datos del pedido
    const cartJson = JSON.stringify(cart);
    const { address, cp, city, date, floor, door, type_of_housing, additional_information, shippPrice, total, methodPay } = customerData;
    const customerDataQuery = "INSERT INTO pedidos (cliente_id, direccion_entrega, cp, localidad, fecha_pedido, piso, puerta, tipo_vivienda, observacion, envio_precio, pedido_total, forma_pago, detalle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    pool.getConnection((err, connection) => {
      if (err) {
        console.error("Error al obtener la conexión:", err);
        return;
      }

      connection.beginTransaction((transactionErr) => {
        if (transactionErr) {
          console.error("Error al iniciar la transacción:", transactionErr);
          connection.release();
          return;
        }

        connection.query(queryFindUser, [number_id], (findUserError, findUserResults) => {
          if (findUserError) {
            console.error("Error al buscar usuario:", findUserError);
            connection.rollback(() => {
              console.error("Transacción revertida debido a un error en la búsqueda del usuario.");
              connection.release();
            });
            return;
          }

          if (findUserResults.length > 0) {
            const usuarioId = findUserResults[0].id;
            console.log("Usuario encontrado, ID:", usuarioId);

            connection.query(customerDataQuery, [usuarioId, address, cp, city, date, floor, door, type_of_housing, additional_information, shippPrice, total, methodPay, cartJson], (pedidoError, pedidoResults) => {
              if (pedidoError) {
                console.error("Error al insertar datos de pedido:", pedidoError);
                connection.rollback(() => {
                  console.error("Transacción revertida debido a un error en la inserción del pedido.");
                  connection.release();
                });
                return;
              }

              connection.commit((commitErr) => {
                if (commitErr) {
                  console.error("Error al confirmar la transacción:", commitErr);
                  connection.rollback(() => {
                    console.error("Transacción revertida debido a un error en la confirmación.");
                    connection.release();
                  });
                } else {
                  console.log("Datos insertados correctamente en pedidos.");
                  connection.release();
                }
              });
            });
          } else {
            console.error("Usuario no encontrado con ese número de identificación.");
            connection.rollback(() => {
              connection.release();
            });
            res.status(404).json({ error: "Usuario no encontrado" });
            return;
          }
        });
      });
    });

    const preference = new Preference(client);
    const result = await preference.create({ body });

    res.json({
      id: result.id,
    });
  } catch (error) {
    console.error("Error al crear la preferencia:", error.message);
    res.status(500).json({
      error: error.message,
    });
  }
});

app.listen(port, () => {
  console.log("el servidor esta corriendo en el puerto 8000");
});