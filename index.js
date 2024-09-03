import express, { json } from "express";
import cors from "cors";
import mysql from 'mysql';
import util from 'util';
import dotenv from 'dotenv';
import { MercadoPagoConfig, Preference } from "mercadopago";

const client = new MercadoPagoConfig({
  accessToken: "APP_USR-6794150768740601-102714-e046b0986d62551114608a1535d5693e-130952820",
});

const app = express();
const port = 8000;

dotenv.config();

var pool = mysql.createPool({
  connectionLimit: 100,
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DB_NAME,
  port: process.env.MYSQL_PORT,
  connectTimeout: 20000,
});

pool.query = util.promisify(pool.query);

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

    // Asegúrate de que cada item tiene un unit_price
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
        success: "https://www.earplugs.com.ar", // Reemplaza con tu URL de éxito
        failure: "https://www.tusitio.com/failure", // Reemplaza con tu URL de fallo
        pending: "https://www.tusitio.com/pending", // Reemplaza con tu URL de pendiente
      },
      auto_return: "approved",
    };

    // Insertar datos del cliente o actualizar si ya existe
    const { name, surname, type_id, number_id, condition_iva, email, phone } = clientData;
    const queryFindClient = "SELECT cliente_id FROM clientes WHERE numero_identificacion = ?";
    const queryInsertClient = "INSERT INTO clientes (nombre, apellido, tipo_identificacion, numero_identificacion, condicion_iva, email, telefono) VALUES (?, ?, ?, ?, ?, ?, ?)";

    // Convertir cart a JSON y agregarlo a customerData
    const cartJson = JSON.stringify(cart);
    const { address, cp, city, date, floor, door, type_of_housing, additional_information, shippPrice, total, methodPay } = customerData;
    const customerDataQuery = "INSERT INTO pedidos (cliente_id, direccion_entrega, cp, localidad, fecha_pedido, piso, puerta, tipo_vivienda, observacion, envio_precio, pedido_total, forma_pago, detalle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    // Ejecutar las consultas en una transacción
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

        connection.query(queryFindClient, [number_id], (findClientError, findClientResults) => {
          if (findClientError) {
            console.error("Error al buscar cliente:", findClientError);
            connection.rollback(() => {
              console.error("Transacción revertida debido a un error en la búsqueda del cliente.");
              connection.release();
            });
            return;
          }

          let clienteIdGenerado;

          if (findClientResults.length > 0) {
            clienteIdGenerado = findClientResults[0].cliente_id;
            console.log("Cliente encontrado, ID:", clienteIdGenerado);

            connection.query(customerDataQuery, [clienteIdGenerado, address, cp, city, date, floor, door, type_of_housing, additional_information, shippPrice, total, methodPay, cartJson], (pedidoError, pedidoResults) => {
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
                  console.log("Datos insertados correctamente en cliente y pedidos.");
                  connection.release();
                }
              });
            });
          } else {
            connection.query(queryInsertClient, [name, surname, type_id, number_id, condition_iva, email, phone], (clientError, clientResults) => {
              if (clientError) {
                console.error("Error al insertar datos de cliente:", clientError);
                connection.rollback(() => {
                  console.error("Transacción revertida debido a un error en la inserción del cliente.");
                  connection.release();
                });
                return;
              }

              clienteIdGenerado = clientResults.insertId;
              console.log("Cliente insertado, ID:", clienteIdGenerado);

              connection.query(customerDataQuery, [clienteIdGenerado, address, cp, city, date, floor, door, type_of_housing, additional_information, shippPrice, total, methodPay, cartJson], (pedidoError, pedidoResults) => {
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
                    console.log("Datos insertados correctamente en cliente y pedidos.");
                    connection.release();
                  }
                });
              });
            });
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